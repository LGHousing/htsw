import * as htsw from "../src";

import { describe, expect, it } from "vitest";
import { readCases } from "./helpers";

class StringFileLoader implements htsw.FileLoader {
    private readonly files = new Map<string, string>();

    constructor(files: Record<string, string>) {
        for (const [path, source] of Object.entries(files)) {
            this.files.set(path, source);
        }
    }

    fileExists(path: string): boolean {
        return this.files.has(path);
    }

    readFile(path: string): string {
        const source = this.files.get(path);
        if (source === undefined) {
            throw new Error(`File not found: ${path}`);
        }
        return source;
    }

    getParentPath(base: string): string {
        const idx = base.lastIndexOf("/");
        return idx === -1 ? "" : base.slice(0, idx);
    }

    resolvePath(base: string, other: string): string {
        if (other.startsWith("/")) return other;
        if (!base) return other;
        return `${base}/${other}`;
    }
}

describe("Runtime", () => {
    for (const testCase of readCases("test/cases/runtime/")) {
        it(testCase.name, () => {
            const sm = new htsw.SourceMap(
                new StringFileLoader({
                    "/test.htsl": testCase.source,
                }),
            );

            const parsed = htsw.parseActionsResult(sm, "/test.htsl");
            const parseErrors = parsed.diagnostics.filter((d) => d.level === "error");
            expect(parseErrors).toEqual([]);

            const expected: string[] = [];
            const actual: string[] = [];

            const vars = new htsw.runtime.simple.SimpleVars();
            const actionBehaviors = new htsw.runtime.simple.SimpleActionBehaviors(vars).with(
                "MESSAGE",
                (rt, action) => {
                    const note = action.note;
                    const parsedExpect = parseExpectChatTag(note);
                    if (!parsedExpect) return;

                    expected.push(parsedExpect);
                    actual.push(replacePlaceholders(rt, action.message ?? ""));
                },
            );

            const rt = new htsw.runtime.Runtime({
                spans: parsed.spans,
                actionBehaviors,
                conditionBehaviors: new htsw.runtime.simple.SimpleConditionBehaviors(vars),
                placeholderBehaviors: new htsw.runtime.simple.SimplePlaceholderBehaviors(vars),
            });

            rt.runActions(parsed.value);
            expect(actual).toEqual(expected);
        });
    }
});

function parseExpectChatTag(note: string | undefined): string | undefined {
    if (!note || !note.includes("@expect")) return undefined;

    const match = note.match(/@expect\s+"([^"]*)"/);
    if (!match) {
        throw new Error(`Invalid @expect tag format: ${note}`);
    }

    return match[1];
}

function replacePlaceholders(rt: htsw.runtime.Runtime, value: string): string {
    const placeholders = value.match(/%([^%]+?)%/g);
    if (!placeholders) return value;

    for (const placeholder of placeholders) {
        const content = placeholder.substring(1, placeholder.length - 1);
        const resolved = rt.runPlaceholder(content);
        if (!resolved) continue;
        value = value.replace(placeholder, resolved.toString());
    }

    return value;
}
