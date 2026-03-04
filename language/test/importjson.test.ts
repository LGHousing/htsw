import { describe, expect, it } from "vitest";
import * as htsw from "../src";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

class NodeFileLoader implements htsw.FileLoader {
    fileExists(path: string): boolean {
        return existsSync(path);
    }

    readFile(path: string): string {
        return readFileSync(path, "utf8");
    }

    getParentPath(base: string): string {
        return dirname(base);
    }

    resolvePath(base: string, other: string): string {
        return resolve(base, other);
    }
}

function hasHardErrors(diagnostics: htsw.Diagnostic[]): boolean {
    return diagnostics.some((diagnostic) => {
        return diagnostic.level === "error" || diagnostic.level === "bug";
    });
}

function parseImportables(path: string) {
    const fileLoader = new NodeFileLoader();
    const sourceMap = new htsw.SourceMap(fileLoader);
    return htsw.parseImportablesResult(sourceMap, path);
}

function caseDirPath(name: string): string {
    return resolve("test", "cases", "importjson", name, "import.json");
}

function caseFilePath(name: string): string {
    return resolve("test", "cases", "importjson", `${name}.import.json`);
}

describe("import.json include", () => {
    it("multi_file fixture cases have an entry import.json", () => {
        for (const dir of ["merge", "nested", "cycle", "duplicate", "include_import_json_name"]) {
            expect(existsSync(caseDirPath(dir))).toBe(true);
        }
    });

    it("merges importables from included files", () => {
        const result = parseImportables(caseDirPath("merge"));

        const regionNames = result.value
            .filter((importable) => importable.type === "REGION")
            .map((importable) => importable.name)
            .filter((name): name is string => name !== undefined);

        expect(regionNames).toEqual(expect.arrayContaining(["RootRegion", "SharedRegion"]));
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("supports nested includes", () => {
        const result = parseImportables(caseDirPath("nested"));

        const regionNames = result.value
            .filter((importable) => importable.type === "REGION")
            .map((importable) => importable.name)
            .filter((name): name is string => name !== undefined);

        expect(regionNames).toEqual(expect.arrayContaining(["RegionA", "RegionB"]));
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("reports missing include files", () => {
        const result = parseImportables(caseFilePath("missing"));

        expect(
            result.diagnostics.some((diagnostic) => {
                return diagnostic.message.includes("Included import.json not found");
            })
        ).toBe(true);
        expect(hasHardErrors(result.diagnostics)).toBe(true);
    });

    it("reports include cycles", () => {
        const result = parseImportables(caseDirPath("cycle"));

        expect(
            result.diagnostics.some((diagnostic) => {
                return diagnostic.message.includes("Circular import.json include");
            })
        ).toBe(true);
        expect(hasHardErrors(result.diagnostics)).toBe(true);
    });

    it("warns for duplicate include entries", () => {
        const result = parseImportables(caseDirPath("duplicate"));

        const duplicateWarningCount = result.diagnostics.filter((diagnostic) => {
            return diagnostic.level === "warning"
                && diagnostic.message.includes("Duplicate include path");
        }).length;

        expect(duplicateWarningCount).toBe(1);
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });
});

describe("import.json basic passing behavior", () => {
    it("parses an empty import.json without diagnostics", () => {
        const result = parseImportables(caseFilePath("empty"));

        expect(result.value.length).toBe(0);
        expect(result.diagnostics.length).toBe(0);
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a single region importable", () => {
        const result = parseImportables(caseFilePath("region"));

        expect(result.value.length).toBe(1);
        expect(result.value[0].type).toBe("REGION");
        expect(result.value[0].name).toBe("SpawnRegion");
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a single function importable", () => {
        const result = parseImportables(caseFilePath("function"));

        expect(result.value.length).toBe(1);
        expect(result.value[0].type).toBe("FUNCTION");
        expect(result.value[0].name).toBe("TickFn");
        expect(result.value[0].repeatTicks).toBe(20);
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a function importable without repeatTicks", () => {
        const result = parseImportables(caseFilePath("function_no_repeat"));

        expect(result.value.length).toBe(1);
        expect(result.value[0].type).toBe("FUNCTION");
        expect(result.value[0].name).toBe("NoRepeatFn");
        expect(result.value[0].repeatTicks).toBeUndefined();
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a single event importable", () => {
        const result = parseImportables(caseFilePath("event"));

        expect(result.value.length).toBe(1);
        expect(result.value[0].type).toBe("EVENT");
        expect(result.value[0].event).toBe("Player Join");
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a single npc importable", () => {
        const result = parseImportables(caseFilePath("npc"));

        expect(result.value.length).toBe(1);
        expect(result.value[0].type).toBe("NPC");
        expect(result.value[0].name).toBe("Guide");
        expect(result.value[0].pos?.x).toBe(1);
        expect(result.value[0].pos?.y).toBe(2);
        expect(result.value[0].pos?.z).toBe(3);
        expect(result.value[0].lookAtPlayers).toBe(true);
        expect(result.value[0].hideNameTag).toBe(false);
        expect(result.value[0].skin).toBe("Steve");
        expect(result.value[0].equipment?.helmet).toBe("empty.snbt");
        expect(result.value[0].equipment?.hand).toBe("empty.snbt");
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("supports include using import.json filename", () => {
        const result = parseImportables(caseDirPath("include_import_json_name"));

        const regionNames = result.value
            .filter((importable) => importable.type === "REGION")
            .map((importable) => importable.name)
            .filter((name): name is string => name !== undefined);

        expect(regionNames).toEqual(expect.arrayContaining(["RootRegion", "NamedImportJsonRegion"]));
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });
});

describe("import.json diagnostics readability", () => {
    it("includes help for missing include files", () => {
        const result = parseImportables(caseFilePath("missing"));
        const diag = result.diagnostics.find((it) =>
            it.message.includes("Included import.json not found")
        );

        expect(diag).toBeDefined();
        expect(
            diag!.subDiagnostics.some((it) =>
                it.message.includes("Check the include path and verify the target file exists")
            )
        ).toBe(true);
    });

    it("includes valid keys help for unknown keys", () => {
        const result = parseImportables(caseFilePath("unknown_key"));
        const diag = result.diagnostics.find((it) => it.message.includes("Unknown key 'oops'"));

        expect(diag).toBeDefined();
        expect(
            diag!.subDiagnostics.some((it) =>
                it.message.includes("Valid keys are:")
            )
        ).toBe(true);
    });

    it("includes allowed keys help for missing required keys", () => {
        const result = parseImportables(caseFilePath("missing_required"));
        const diag = result.diagnostics.find((it) =>
            it.message.includes("Missing required key 'actions'")
        );

        expect(diag).toBeDefined();
        expect(
            diag!.subDiagnostics.some((it) =>
                it.message.includes("Allowed keys here:")
            )
        ).toBe(true);
    });
});

