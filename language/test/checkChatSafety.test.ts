import { describe, expect, it } from "vitest";
import * as htsw from "../src";

const NUL = "\u0000";
const DEL = "\u007f";
const SECTION = "§";

class HtslFileLoader implements htsw.FileLoader {
    constructor(private readonly htsl: string) {}

    fileExists(path: string): boolean {
        return path === "/project/import.json" || path === "/project/actions.htsl";
    }

    readFile(path: string): string {
        if (path === "/project/import.json") {
            return JSON.stringify({
                functions: [{ name: "Test Function", actions: "actions.htsl" }],
            });
        }
        if (path === "/project/actions.htsl") return this.htsl;
        throw new Error(`File not found: ${path}`);
    }

    getParentPath(path: string): string {
        return path.slice(0, path.lastIndexOf("/"));
    }

    resolvePath(base: string, other: string): string {
        return `${base}/${other}`;
    }
}

function errorsFor(htsl: string): string[] {
    const sourceMap = new htsw.SourceMap(new HtslFileLoader(htsl));
    return htsw
        .parseImportablesResult(sourceMap, "/project/import.json")
        .diagnostics.filter((diagnostic) => diagnostic.level === "error")
        .map((diagnostic) => diagnostic.message);
}

describe("findIllegalChatCharacter", () => {
    it("accepts ordinary values, including & colour codes", () => {
        expect(htsw.helpers.findIllegalChatCharacter("&aHello %player.name%")).toBe(null);
    });

    it("reports the first control character", () => {
        expect(htsw.helpers.findIllegalChatCharacter(`ab${NUL}c${NUL}`)).toEqual({
            index: 2,
            code: 0,
        });
    });

    it("reports DEL and the section sign", () => {
        expect(htsw.helpers.findIllegalChatCharacter(`a${DEL}`)).toEqual({
            index: 1,
            code: 0x7f,
        });
        expect(htsw.helpers.findIllegalChatCharacter(`${SECTION}a`)).toEqual({
            index: 0,
            code: 0xa7,
        });
    });

    it("accepts characters above the BMP", () => {
        expect(htsw.helpers.findIllegalChatCharacter("\u{1f600}")).toBe(null);
    });
});

describe("describeCharCode", () => {
    it("names the characters an author is likely to hit", () => {
        expect(htsw.helpers.describeCharCode(0)).toBe("NUL U+0000");
        expect(htsw.helpers.describeCharCode(0xa7)).toBe(
            `${SECTION} (section sign) U+00A7`
        );
    });

    it("falls back to the code point", () => {
        expect(htsw.helpers.describeCharCode(0x01)).toBe("U+0001");
    });
});

describe("chat-safety validation", () => {
    // A CHANGE_VAR value keeps its quotes in the stored form, so the reported
    // index counts from the opening quote — the same place the span starts.
    it("rejects a NUL inside a variable value", () => {
        expect(errorsFor(`var "dname" = "&l${NUL}<deferred>" true`)).toEqual([
            "Value contains NUL U+0000 at index 3, which Minecraft's chat cannot " +
                "carry. Housing rejects the whole message and disconnects you with " +
                '"Illegal characters in chat".',
        ]);
    });

    it("rejects a section sign inside a chat message", () => {
        expect(errorsFor(`chat "${SECTION}aHello"`)).toEqual([
            `Value contains ${SECTION} (section sign) U+00A7 at index 0, which ` +
                "Minecraft's chat cannot carry. Housing rejects the whole message " +
                'and disconnects you with "Illegal characters in chat".',
        ]);
    });

    it("rejects a control character inside a condition value", () => {
        const errors = errorsFor(`if and (var "id" == "a${NUL}b" 0) {\n}`);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("NUL U+0000 at index 2");
    });

    it("accepts values that only use & colour codes", () => {
        expect(errorsFor('var "dname" = "&f%player.name%" true')).toEqual([]);
    });
});
