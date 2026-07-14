import { describe, expect, it } from "vitest";
import { DummyFileLoader, SourceFile, SourceMap } from "../src/sourceMap";

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
