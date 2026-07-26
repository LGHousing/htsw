import { describe, expect, it } from "vitest";
import { DummyFileLoader, SourceFile, SourceMap } from "../src/sourceMap";

function referencePosition(
    src: string,
    startPos: number,
    pos: number
): { line: number; column: number } {
    const index = pos - startPos;
    if (index < 0 || index > src.length) return { line: 1, column: 1 };

    let line = 1;
    let lastLineBreak = -1;
    for (let i = 0; i < index; i++) {
        if (src.charAt(i) === "\n") {
            line++;
            lastLineBreak = i;
        }
    }
    return { line, column: index - lastLineBreak };
}

function referenceLine(src: string, lineNumber: number): string {
    if (lineNumber < 1) return "";

    let currentLine = 1;
    let start = 0;
    for (let i = 0; i < src.length; i++) {
        if (src.charAt(i) === "\n") {
            if (currentLine === lineNumber) return src.slice(start, i);
            currentLine++;
            start = i + 1;
        }
    }
    return currentLine === lineNumber ? src.slice(start) : "";
}

describe("SourceMap", () => {
    it("keeps one file's end position separate from the next file", () => {
        const sourceMap = new SourceMap(new DummyFileLoader());
        const first = new SourceFile("first.htsl", "chat");
        const second = new SourceFile("second.htsl", "exit");

        sourceMap.registerFile(first);
        sourceMap.registerFile(second);

        expect(sourceMap.getFileByPos(first.endPos())).toBe(first);
        expect(sourceMap.getFileByPos(second.startPos)).toBe(second);
        expect(second.startPos).toBe(first.endPos() + 1);
    });
});

describe("SourceFile line positions", () => {
    const sources = [
        "",
        "single line",
        "trailing newline\n",
        "first\r\nsecond\r\nthird",
        "\n\nconsecutive\n\n",
    ];

    it.each(sources)(
        "matches the old position and line behavior for %j",
        (src) => {
            const file = new SourceFile("test.htsl", src);
            file.startPos = 13;
            for (let index = -2; index <= src.length + 2; index++) {
                const pos = file.startPos + index;
                expect(file.getPosition(pos)).toEqual(
                    referencePosition(src, file.startPos, pos)
                );
            }

            let lineCount = 1;
            for (let i = 0; i < src.length; i++) {
                if (src.charAt(i) === "\n") lineCount++;
            }
            for (let line = -1; line <= lineCount + 2; line++) {
                expect(file.getLine(line)).toBe(referenceLine(src, line));
            }
        }
    );

    it("matches the old algorithms at every offset and line in a generated file", () => {
        let src = "";
        for (let i = 0; i < 180; i++) {
            src += `line-${i}`;
            if (i % 11 === 0) src += "\n";
            src += i % 3 === 0 ? "\r\n" : "\n";
        }
        const file = new SourceFile("generated.htsl", src);
        file.startPos = 37;

        for (let index = -1; index <= src.length + 1; index++) {
            const pos = file.startPos + index;
            expect(file.getPosition(pos)).toEqual(
                referencePosition(src, file.startPos, pos)
            );
        }

        let lineCount = 1;
        for (let i = 0; i < src.length; i++) {
            if (src.charAt(i) === "\n") lineCount++;
        }
        for (let line = -1; line <= lineCount + 1; line++) {
            expect(file.getLine(line)).toBe(referenceLine(src, line));
        }
    });

    it("rebuilds line positions when src changes", () => {
        const file = new SourceFile("mutable.htsl", "one line");
        file.startPos = 5;
        expect(file.getPosition(file.endPos())).toEqual({ line: 1, column: 9 });
        expect(file.getLine(1)).toBe("one line");

        file.src = "first\r\n\nthird\n";
        for (let index = -1; index <= file.src.length + 1; index++) {
            const pos = file.startPos + index;
            expect(file.getPosition(pos)).toEqual(
                referencePosition(file.src, file.startPos, pos)
            );
        }
        for (let line = -1; line <= 6; line++) {
            expect(file.getLine(line)).toBe(referenceLine(file.src, line));
        }
    });
});
