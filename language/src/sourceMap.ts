import { Diagnostic } from "./diagnostic";

/**
 * An abstraction over filesystem operations used by the parser.
 */
export interface FileLoader {

    fileExists(path: string): boolean;

    readFile(path: string): string;
    
    getParentPath(base: string): string;
    
    resolvePath(base: string, other: string): string;

}

export class DummyFileLoader implements FileLoader {
    fileExists(path: string): boolean {
        return false;
    }
    readFile(path: string): string {
        throw new Error("Not implemented!");
    }
    getParentPath(base: string): string {
        throw new Error("Not implemented!");
    }
    resolvePath(base: string, other: string): string {
        throw new Error("Not implemented!");
    }
}

export class SourceFile {
    path: string;
    src: string;
    startPos: number;
    private lineBreakPositions: number[];
    private lineBreakPositionsSource: string | null;

    constructor(path: string, src: string) {
        this.path = path;
        this.src = src;
        this.startPos = 0;
        this.lineBreakPositions = [];
        this.lineBreakPositionsSource = null;
    }

    private getLineBreakPositions(): number[] {
        if (this.lineBreakPositionsSource !== this.src) {
            const positions: number[] = [];
            for (let i = 0; i < this.src.length; i++) {
                if (this.src.charAt(i) === "\n") {
                    positions.push(i);
                }
            }
            this.lineBreakPositions = positions;
            this.lineBreakPositionsSource = this.src;
        }
        return this.lineBreakPositions;
    }

    getPosition(pos: number): { line: number; column: number } {
        const index = pos - this.startPos;

        if (index < 0 || index > this.src.length) {
            return { line: 1, column: 1 };
        }

        let line = 1;
        let lastLineBreak = -1;
        const lineBreakPositions = this.getLineBreakPositions();
        for (let i = 0; i < lineBreakPositions.length; i++) {
            const lineBreak = lineBreakPositions[i];
            if (lineBreak >= index) break;
            line++;
            lastLineBreak = lineBreak;
        }

        const column = index - lastLineBreak;

        return { line, column };
    }
    
    getLine(lineNumber: number): string {
        if (lineNumber < 1) return "";

        const lineBreakPositions = this.getLineBreakPositions();
        if (lineNumber > lineBreakPositions.length + 1) return "";
        const lineIndex = lineNumber - 1;
        const start = lineIndex === 0 ? 0 : lineBreakPositions[lineIndex - 1] + 1;
        const end =
            lineIndex < lineBreakPositions.length
                ? lineBreakPositions[lineIndex]
                : this.src.length;
        return this.src.slice(start, end);
    }

    getLineStartPos(lineNumber: number): number {
        if (lineNumber < 1) return 0;

        let currentLine = 1;
        let start = 0;

        for (let i = 0; i < this.src.length; i++) {
            if (this.src.charAt(i) === "\n") {
                if (currentLine === lineNumber) {
                    return start + this.startPos;
                }
                currentLine++;
                start = i + 1;
            }
        }

        if (currentLine === lineNumber) {
            return start + this.startPos;
        }

        throw new Error("Position out of bounds");
    }

    endPos(): number {
        return this.startPos + this.src.length;
    }
}

export class SourceMap {
    fileLoader: FileLoader;
    sourceFiles: SourceFile[];

    constructor(fileLoader: FileLoader) {
        this.fileLoader = fileLoader;
        this.sourceFiles = [];
    }

    loadFile(path: string): SourceFile {
        if (!this.fileLoader.fileExists(path)) {
            throw Error("Source file location does not exist");
        }

        // try to read the file
        let src: string;
        try {
            src = this.fileLoader.readFile(path);
        } catch (e) {
            throw Diagnostic.error(`Failed to read file '${path}'`);
        }

        const file = new SourceFile(path, src);
        this.registerFile(file);
        return file;
    }

    registerFile(file: SourceFile) {
        if (this.sourceFiles.length > 0) {
            const last = this.sourceFiles[this.sourceFiles.length - 1];
            file.startPos = last.endPos() + 1;
        }

        this.sourceFiles.push(file);
    }

    hasFile(path: string): boolean {
        for (const file of this.sourceFiles) {
            if (file.path === path) return true;
        }
        return false;
    }

    getFile(path: string): SourceFile {
        for (const file of this.sourceFiles) {
            if (file.path === path) return file;
        }

        return this.loadFile(path);
    }

    getFileByPos(pos: number): SourceFile {
        for (const file of this.sourceFiles) {
            const start = file.startPos;
            const end = file.endPos();

            if (pos >= start && pos <= end) {
                return file;
            }
        }

        throw Error(`Source position lookup out of bounds ${pos}`);
    }

}
