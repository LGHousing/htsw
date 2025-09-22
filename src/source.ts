export class SourceMap {
    files: SourceFile[];

    constructor(files: SourceFile[] = []) {
        this.files = files;
    }

    addFile(src: string, path: string) {
        this.files.push(new SourceFile(src, path));
    }

    positionAt(offset: number): SourcePos {
        let currentOffset = 0;

        for (const file of this.files) {
            const fileLength = file.src.length;
            if (offset < currentOffset + fileLength) {
                const relativeOffset = offset - currentOffset;
                return file.positionAt(relativeOffset);
            }
            currentOffset += fileLength;
        }

        throw new Error("Offset out of bounds");
    }

    lineAt(offset: number): string {
        let currentOffset = 0;

        for (const file of this.files) {
            const fileLength = file.src.length;
            if (offset < currentOffset + fileLength) {
                const relativeOffset = offset - currentOffset;
                return file.lineAt(relativeOffset);
            }
            currentOffset += fileLength;
        }

        throw new Error("Offset out of bounds");
    }
}

export class SourceFile {
    src: string;
    path: string;
    private lineStarts: number[];

    constructor(src: string, path: string) {
        this.src = src;
        this.path = path;
        this.lineStarts = this.computeLineStarts();
    }

    private computeLineStarts(): number[] {
        const lineStarts = [0];
        for (let i = 0; i < this.src.length; i++) {
            if (this.src[i] === "\n") {
                lineStarts.push(i + 1);
            }
        }
        return lineStarts;
    }

    positionAt(offset: number): SourcePos {
        for (let i = 0; i < this.lineStarts.length; i++) {
            const start = this.lineStarts[i];
            const end =
                i + 1 < this.lineStarts.length ? this.lineStarts[i + 1] : this.src.length;
            if (offset < end) {
                return {
                    line: i + 1,
                    column: offset - start,
                };
            }
        }

        throw new Error("Offset out of bounds in SourceFile");
    }

    lineAt(offset: number): string {
        for (let i = 0; i < this.lineStarts.length; i++) {
            const start = this.lineStarts[i];
            const end =
                i + 1 < this.lineStarts.length
                    ? this.lineStarts[i + 1] - 1
                    : this.src.length;
            if (offset < end + 1) {
                return this.src.slice(start, end);
            }
        }

        throw new Error("Offset out of bounds in SourceFile");
    }
}

export type SourcePos = {
    line: number;
    column: number;
};
