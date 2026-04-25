import { describe, expect, it } from "vitest";

import * as htsw from "../src";

class InMemoryFileLoader implements htsw.FileLoader {
    constructor(private readonly source: string) {}
    fileExists(_path: string): boolean { return true; }
    readFile(_path: string): string { return this.source; }
    getParentPath(_base: string): string { return ""; }
    resolvePath(_base: string, other: string): string { return other; }
}

function parseSource(source: string): htsw.types.Action[] {
    const sm = new htsw.SourceMap(new InMemoryFileLoader(source));
    const result = htsw.parseActionsResult(sm, "test.htsl");
    const errors = result.diagnostics.filter((d) => d.level === "error");
    if (errors.length > 0) {
        throw new Error(
            `Source did not parse cleanly:\n${errors.map((e) => e.message).join("\n")}`
        );
    }
    return result.value;
}

describe("printer: condition notes", () => {
    it("round-trips a single condition with a note", () => {
        const src = [
            "if (",
            "    /// resident or higher",
            "    hasGroup \"Resident\" true",
            ") {",
            "    chat \"hi\"",
            "}",
        ].join("\n") + "\n";
        const actions = parseSource(src);
        const printed = htsw.htsl.printActions(actions);
        const reparsed = parseSource(printed);
        expect(reparsed).toEqual(actions);
        expect(htsw.htsl.printActions(reparsed)).toEqual(printed);
    });

    it("round-trips multiple conditions where some have notes", () => {
        const src = [
            "if (",
            "    /// must be a resident",
            "    hasGroup \"Resident\" true,",
            "    isFlying,",
            "    /// no creative cheaters",
            "    !gamemode creative",
            ") {",
            "    chat \"ok\"",
            "}",
        ].join("\n") + "\n";
        const actions = parseSource(src);
        const printed = htsw.htsl.printActions(actions);
        const reparsed = parseSource(printed);
        expect(reparsed).toEqual(actions);
        expect(htsw.htsl.printActions(reparsed)).toEqual(printed);
    });

    it("keeps the compact form when no condition has a note", () => {
        const src = "if (isFlying, isSneaking) {\n    chat \"x\"\n}\n";
        const actions = parseSource(src);
        const printed = htsw.htsl.printActions(actions);
        // Compact form preserved.
        expect(printed).toContain("if (isFlying, isSneaking)");
    });

    it("expands to multi-line and preserves matchAny mode when notes exist", () => {
        const src = [
            "if or (",
            "    /// either case",
            "    isFlying,",
            "    isSneaking",
            ") {",
            "    chat \"x\"",
            "}",
        ].join("\n") + "\n";
        const actions = parseSource(src);
        const printed = htsw.htsl.printActions(actions);
        expect(printed).toContain("if or (");
        const reparsed = parseSource(printed);
        expect(reparsed).toEqual(actions);
    });
});
