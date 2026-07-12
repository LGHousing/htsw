import { describe, expect, it } from "vitest";
import * as htsw from "htsw";

import { actionLineRange } from "../src/gui/code-view/htslParse";

class StringFileLoader implements htsw.FileLoader {
    constructor(private readonly source: string) {}

    fileExists(): boolean {
        return true;
    }

    readFile(): string {
        return this.source;
    }

    getParentPath(): string {
        return "";
    }

    resolvePath(_base: string, other: string): string {
        return other;
    }
}

describe("actionLineRange", () => {
    it("does not let a conditional ending on a newline claim the next header", () => {
        const path = "/adjacent-conditionals.htsl";
        const source = [
            "if (var first == 1) {",
            "    exit",
            "}",
            "if (var second == 2) {",
            "    exit",
            "}",
            "",
        ].join("\n");
        const sourceMap = new htsw.SourceMap(new StringFileLoader(source));
        const parsed = htsw.parseActionsResult(sourceMap, path);
        const file = sourceMap.getFile(path);

        expect(actionLineRange(file, parsed.spans, parsed.value[0])).toEqual({
            start: 1,
            end: 3,
        });
        expect(actionLineRange(file, parsed.spans, parsed.value[1])).toEqual({
            start: 4,
            end: 6,
        });
    });
});
