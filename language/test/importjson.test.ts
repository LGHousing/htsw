import { describe, expect, it } from "vitest";
import * as htsw from "../src";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { assertImportable } from "./helpers";

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
        for (const dir of [
            "merge",
            "nested",
            "cycle",
            "duplicate",
            "include_import_json_name",
        ]) {
            expect(existsSync(caseDirPath(dir))).toBe(true);
        }
    });

    it("merges importables from included files", () => {
        const result = parseImportables(caseDirPath("merge"));

        const regionNames = result.value
            .filter(
                (importable): importable is htsw.types.ImportableRegion =>
                    importable.type === "REGION"
            )
            .map((importable) => importable.name);

        expect(regionNames).toEqual(
            expect.arrayContaining(["RootRegion", "SharedRegion"])
        );
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("supports nested includes", () => {
        const result = parseImportables(caseDirPath("nested"));

        const regionNames = result.value
            .filter(
                (importable): importable is htsw.types.ImportableRegion =>
                    importable.type === "REGION"
            )
            .map((importable) => importable.name);

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
            return (
                diagnostic.level === "warning" &&
                diagnostic.message.includes("Duplicate include path")
            );
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
        const region = result.value[0];
        assertImportable(region, "REGION");
        expect(region.name).toBe("SpawnRegion");
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a single function importable", () => {
        const result = parseImportables(caseFilePath("function"));

        expect(result.value.length).toBe(1);
        const fn = result.value[0];
        assertImportable(fn, "FUNCTION");
        expect(fn.name).toBe("TickFn");
        expect(fn.repeatTicks).toBe(20);
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a function importable without repeatTicks", () => {
        const result = parseImportables(caseFilePath("function_no_repeat"));

        expect(result.value.length).toBe(1);
        const fn = result.value[0];
        assertImportable(fn, "FUNCTION");
        expect(fn.name).toBe("NoRepeatFn");
        expect(fn.repeatTicks).toBeUndefined();
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a single event importable", () => {
        const result = parseImportables(caseFilePath("event"));

        expect(result.value.length).toBe(1);
        const event = result.value[0];
        assertImportable(event, "EVENT");
        expect(event.event).toBe("Player Join");
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a single npc importable", () => {
        const result = parseImportables(caseFilePath("npc"));

        expect(result.value.length).toBe(1);
        const npc = result.value[0];
        assertImportable(npc, "NPC");
        expect(npc.name).toBe("Guide");
        expect(npc.pos?.x).toBe(1);
        expect(npc.pos?.y).toBe(2);
        expect(npc.pos?.z).toBe(3);
        expect(npc.lookAtPlayers).toBe(true);
        expect(npc.hideNameTag).toBe(false);
        expect(npc.skin).toBe("Steve");
        expect(npc.equipment?.helmet).toBe("empty.snbt");
        expect(npc.equipment?.hand).toBe("empty.snbt");
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a single item importable", () => {
        const result = parseImportables(caseFilePath("item"));

        expect(result.value.length).toBe(1);
        const item = result.value[0];
        assertImportable(item, "ITEM");
        expect(item.name).toBe("Stone Item");
        expect(item.nbt.type).toBe("compound");
        if (item.nbt.type === "compound") {
            expect(item.nbt.value.id).toEqual({
                type: "string",
                value: "minecraft:stone",
            });
        }
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("supports include using import.json filename", () => {
        const result = parseImportables(caseDirPath("include_import_json_name"));

        const regionNames = result.value
            .filter(
                (importable): importable is htsw.types.ImportableRegion =>
                    importable.type === "REGION"
            )
            .map((importable) => importable.name);

        expect(regionNames).toEqual(
            expect.arrayContaining(["RootRegion", "NamedImportJsonRegion"])
        );
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
                it.message.includes(
                    "Check the include path and verify the target file exists"
                )
            )
        ).toBe(true);
    });

    it("includes valid keys help for unknown keys", () => {
        const result = parseImportables(caseFilePath("unknown_key"));
        const diag = result.diagnostics.find((it) =>
            it.message.includes("Unknown key 'oops'")
        );

        expect(diag).toBeDefined();
        expect(
            diag!.subDiagnostics.some((it) => it.message.includes("Valid keys are:"))
        ).toBe(true);
    });

    it("includes allowed keys help for missing required keys", () => {
        const result = parseImportables(caseFilePath("missing_required"));
        const diag = result.diagnostics.find((it) =>
            it.message.includes("Missing required key 'actions'")
        );

        expect(diag).toBeDefined();
        expect(
            diag!.subDiagnostics.some((it) => it.message.includes("Allowed keys here:"))
        ).toBe(true);
    });

    it("reports malformed action files without crashing checker passes", () => {
        let result: ReturnType<typeof parseImportables> | undefined;

        expect(() => {
            result = parseImportables(caseFilePath("malformed_actions"));
        }).not.toThrow();

        expect(result).toBeDefined();
        expect(hasHardErrors(result!.diagnostics)).toBe(true);
        expect(
            result!.diagnostics.some((diagnostic) =>
                diagnostic.message.includes("Expected condition")
            )
        ).toBe(true);
    });

    it("reports duplicate top-level item names", () => {
        const result = parseImportables(caseFilePath("duplicate_items"));

        expect(hasHardErrors(result.diagnostics)).toBe(true);
        expect(
            result.diagnostics.some((diagnostic) =>
                diagnostic.message.includes("Duplicate item name 'Token'")
            )
        ).toBe(true);
    });

    it("reports item references that do not match top-level item names", () => {
        const result = parseImportables(caseFilePath("unknown_item_reference"));

        expect(hasHardErrors(result.diagnostics)).toBe(true);
        expect(
            result.diagnostics.some((diagnostic) =>
                diagnostic.message.includes("Unknown item 'Token Display Name'")
            )
        ).toBe(true);
    });

    it("supports direct SNBT item paths relative to the containing HTSL file", () => {
        const result = parseImportables(caseDirPath("direct_snbt"));

        expect(hasHardErrors(result.diagnostics)).toBe(false);
        expect(result.value.length).toBe(1);
    });

    it("reports missing direct SNBT item paths", () => {
        const result = parseImportables(caseFilePath("missing_direct_snbt"));

        expect(hasHardErrors(result.diagnostics)).toBe(true);
        expect(
            result.diagnostics.some((diagnostic) =>
                diagnostic.message.includes("SNBT item file does not exist")
            )
        ).toBe(true);
    });

    it("reports invalid direct SNBT item paths", () => {
        const result = parseImportables(caseFilePath("invalid_direct_snbt"));

        expect(hasHardErrors(result.diagnostics)).toBe(true);
    });

    it("keeps top-level item names authoritative over direct SNBT paths", () => {
        const result = parseImportables(caseFilePath("item_name_wins_over_snbt_path"));

        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });
});
