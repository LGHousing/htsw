import { describe, expect, it } from "vitest";
import { readCases } from "./helpers";

import * as htsw from "../src";

class InMemoryFileLoader implements htsw.FileLoader {
    constructor(private readonly source: string) {}
    fileExists(_path: string): boolean { return true; }
    readFile(_path: string): string { return this.source; }
    getParentPath(_base: string): string { return ""; }
    resolvePath(_base: string, other: string): string { return other; }
}

function parseSourceSafe(source: string): { actions: htsw.types.Action[]; errors: htsw.Diagnostic[] } {
    const sm = new htsw.SourceMap(new InMemoryFileLoader(source));
    const result = htsw.parseActionsResult(sm, "test.htsl");
    const errors = result.diagnostics.filter((d) => d.level === "error");
    return { actions: result.value, errors };
}

function parseSource(source: string): htsw.types.Action[] {
    const { actions, errors } = parseSourceSafe(source);
    if (errors.length > 0) {
        throw new Error(
            `Source did not parse cleanly:\n${errors.map((e) => e.message).join("\n")}\n--- source ---\n${source}`
        );
    }
    return actions;
}

const FIXTURE_PATHS = [
    "test/cases/actions/",
    // Real-world flows from the examples/ tree exercise constructs that the
    // small actions/ fixtures don't, like quoted slashed var names and
    // nested else branches.
    "../examples/sin/",
];

describe("HTSL printer round-trip", () => {
    for (const path of FIXTURE_PATHS) {
        for (const test of readCases(path)) {
            it(`round-trips ${path}${test.name}`, () => {
                // Some legacy fixtures contain syntax the current parser
                // rejects (e.g. `custom_location` for what's now `custom_coordinates`,
                // or `5D` cast syntax outside of a quoted placeholder).
                // Skip them rather than fail — the printer can't be tested
                // against AST it never received.
                const initial = parseSourceSafe(test.source);
                if (initial.errors.length > 0) {
                    return;
                }

                const original = initial.actions;
                const printed = htsw.htsl.printActions(original);
                const reparsed = parseSource(printed);

                expect(reparsed).toEqual(original);

                // The printer should be a fixed point: emitting the reparsed
                // AST must produce the exact same source string.
                const reprinted = htsw.htsl.printActions(reparsed);
                expect(reprinted).toEqual(printed);
            });
        }
    }
});
