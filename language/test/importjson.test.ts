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

function walkFileTree(node: htsw.ImportJsonFileNode): string[] {
    const seen = new Set<htsw.ImportJsonFileNode>();
    const paths: string[] = [];
    const visit = (node: htsw.ImportJsonFileNode): void => {
        if (seen.has(node)) throw new Error(`Cyclic file tree at ${node.path}`);
        seen.add(node);
        paths.push(node.path);
        for (const child of node.includes) visit(child);
        seen.delete(node);
    };
    visit(node);
    return paths;
}

describe("import.json include", () => {
    it("multi_file fixture cases have an entry import.json", () => {
        for (const dir of [
            "merge",
            "nested",
            "cycle",
            "rehome_back_edge",
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

    it("records the include structure as a file tree", () => {
        const entry = caseDirPath("nested");
        const result = parseImportables(entry);

        const dir = dirname(entry);
        const aPath = resolve(dir, "a.import.json");
        const bPath = resolve(dir, "b.import.json");
        const root = result.importJson.fileTree;
        expect(root?.path).toBe(entry);
        expect(root?.includes.map((n) => n.path)).toEqual([aPath]);
        const aNode = root!.includes[0];
        expect(aNode.includes.map((n) => n.path)).toEqual([bPath]);
        expect(aNode.includes[0].includes).toEqual([]);

        const regionA = result.value.find(
            (imp) => imp.type === "REGION" && imp.name === "RegionA"
        );
        expect(regionA).toBeDefined();
        expect(aNode.importables).toContain(regionA!);
        expect(result.importJson.declaringPathOf(regionA!)).toBe(aPath);
    });

    it("records a repeat include as a reference leaf", () => {
        const entry = caseDirPath("repeat_include");
        const result = parseImportables(entry);

        const dir = dirname(entry);
        const cPath = resolve(dir, "c", "import.json");
        const root = result.importJson.fileTree;
        const [aNode, bNode] = root!.includes;

        expect(aNode.includes.map((n) => n.path)).toEqual([cPath]);
        expect(aNode.includes[0].reference).toBeUndefined();
        expect(aNode.includes[0].importables.length).toBe(1);

        expect(bNode.includes.map((n) => n.path)).toEqual([cPath]);
        expect(bNode.includes[0].reference).toBe(true);
        expect(bNode.includes[0].importables).toEqual([]);
        expect(bNode.includes[0].includes).toEqual([]);

        expect(hasHardErrors(result.diagnostics)).toBe(false);
        // The shared file's importables merge once, not per include edge.
        expect(
            result.value.filter((imp) => imp.type === "REGION").length
        ).toBe(1);
    });

    it("homes a file's contents at the folder-shaped include edge", () => {
        const entry = caseDirPath("rehome");
        const result = parseImportables(entry);

        const dir = dirname(entry);
        const menusPath = resolve(dir, "shared", "menus", "import.json");
        const root = result.importJson.fileTree;
        const [alphaNode, sharedNode] = root!.includes;

        // alpha parses first, but its include reaches across folders — after
        // re-homing it holds the reference, and shared (whose directory
        // contains menus/) holds the full node.
        expect(alphaNode.includes.map((n) => n.path)).toEqual([menusPath]);
        expect(alphaNode.includes[0].reference).toBe(true);

        expect(sharedNode.includes.map((n) => n.path)).toEqual([menusPath]);
        expect(sharedNode.includes[0].reference).toBeUndefined();
        expect(sharedNode.includes[0].importables.length).toBe(1);
        expect(result.importJson.declaringPathOf(sharedNode.includes[0].importables[0])).toBe(menusPath);

        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("does not rehome through cyclic reference leaves", () => {
        const entry = caseDirPath("rehome_back_edge");
        const result = parseImportables(entry);

        const dir = dirname(entry);
        const bPath = resolve(dir, "a", "b", "b.import.json");
        const cPath = resolve(dir, "a", "c.import.json");
        const root = result.importJson.fileTree;
        expect(root).not.toBeNull();
        expect(() => walkFileTree(root!)).not.toThrow();
        expect(walkFileTree(root!)).toEqual([entry, bPath, cPath, bPath]);

        const bNode = root!.includes[0];
        const cNode = bNode.includes[0];
        expect(bNode.path).toBe(bPath);
        expect(bNode.reference).toBeUndefined();
        expect(cNode.path).toBe(cPath);
        expect(cNode.includes[0].path).toBe(bPath);
        expect(cNode.includes[0].reference).toBe(true);
        expect(cNode.includes[0].importables).toEqual([]);
        expect(cNode.includes[0].includes).toEqual([]);
        expect(result.importJson.declaringPathOf(bNode.importables[0])).toBe(bPath);
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("records a cyclic include as a reference leaf", () => {
        const entry = caseDirPath("cycle");
        const result = parseImportables(entry);

        const otherPath = resolve(dirname(entry), "other.import.json");
        const root = result.importJson.fileTree;
        expect(root?.includes.map((n) => n.path)).toEqual([otherPath]);
        expect(root?.includes[0].includes.map((n) => n.path)).toEqual([entry]);
        expect(root?.includes[0].includes[0].reference).toBe(true);
        expect(root?.includes[0].includes[0].importables).toEqual([]);
        expect(root?.includes[0].includes[0].includes).toEqual([]);
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("reports missing include files", () => {
        const result = parseImportables(caseFilePath("missing"));

        expect(
            result.diagnostics.some((diagnostic) => {
                return diagnostic.message.includes("Couldn't read `does_not_exist.import.json` file");
            })
        ).toBe(true);
        expect(hasHardErrors(result.diagnostics)).toBe(true);
    });

    it("records a missing include as a missing leaf in the file tree", () => {
        const result = parseImportables(caseFilePath("missing"));

        const root = result.importJson.fileTree;
        expect(root).not.toBeNull();
        const missingNodes = root!.includes.filter((node) => node.missing === true);
        expect(missingNodes.length).toBe(1);
        expect(missingNodes[0].importables).toEqual([]);
        expect(missingNodes[0].includes).toEqual([]);
    });

    it("keeps parsing sibling importables after one entry reports a diagnostic", () => {
        const entry = caseDirPath("recover_importable_errors");
        const result = parseImportables(entry);

        const menuNames = result.value
            .filter(
                (importable): importable is htsw.types.ImportableMenu =>
                    importable.type === "MENU"
            )
            .map((importable) => importable.name);

        expect(menuNames).toEqual(["Good Menu", "Later Menu"]);
        const menusPath = resolve(dirname(entry), "menus", "import.json");
        const diagnostic = result.diagnostics.find((diagnostic) =>
            diagnostic.message.includes("Invalid actions file: expected a `.htsl` file")
        );
        expect(diagnostic).toBeDefined();
        const primary = diagnostic!.spans.find((span) => span.kind === "primary");
        expect(primary).toBeDefined();
        const diagnosticFile = result.gcx.sourceMap.getFileByPos(primary!.span.start);
        expect(diagnosticFile.path).toBe(menusPath);
        expect(
            diagnosticFile.src.slice(
                primary!.span.start - diagnosticFile.startPos,
                primary!.span.end - diagnosticFile.startPos
            )
        ).toBe('"Broken_Menu/slot-1"');

        const menusNode = result.importJson.fileTree?.includes.find(
            (node) => node.path === menusPath
        );
        expect(menusNode?.importables.map((importable) => importable.type)).toEqual([
            "MENU",
            "MENU",
        ]);
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

    it("parses a single command importable", () => {
        const result = parseImportables(caseFilePath("command"));

        expect(result.value.length).toBe(1);
        const command = result.value[0];
        assertImportable(command, "COMMAND");
        expect(command.name).toBe("visit");
        expect(command.actions?.length).toBe(1);
        expect(command.mode).toBe("Targeted");
        expect(command.requiredPriority).toBe(3);
        expect(command.listed).toBe(false);
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a single NPC importable", () => {
        const result = parseImportables(caseFilePath("npc"));

        expect(result.value.length).toBe(1);
        const npc = result.value[0];
        assertImportable(npc, "NPC");
        expect(npc.name).toBe("&aGuide");
        expect(npc.pos).toEqual({ x: 1, y: 64, z: -2 });
        expect(npc.leftClickActions?.length).toBe(1);
        expect(npc.rightClickActions?.length).toBe(1);
        expect(npc.leftClickRedirect).toBe(true);
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

    it("parses a function importable icon", () => {
        const result = parseImportables(caseFilePath("function_icon"));

        expect(result.value.length).toBe(1);
        const fn = result.value[0];
        assertImportable(fn, "FUNCTION");
        expect(fn.icon).toEqual({
            item: "minecraft:map",
            count: 3,
            enchanted: true,
        });
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("reports unknown function icon keys", () => {
        const result = parseImportables(caseFilePath("function_icon_unknown_key"));

        expect(
            result.diagnostics.some((diagnostic) =>
                diagnostic.message.includes("Unknown key: `glowing`")
            )
        ).toBe(true);
    });

    it("canonicalizes bare function icon item ids", () => {
        const result = parseImportables(caseFilePath("function_icon_bare"));

        expect(result.value.length).toBe(1);
        const fn = result.value[0];
        assertImportable(fn, "FUNCTION");
        expect(fn.icon).toEqual({
            item: "minecraft:map",
            count: 1,
        });
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("rejects function icon items outside Minecraft 1.8", () => {
        const result = parseImportables(caseFilePath("function_icon_invalid_item"));

        expect(hasHardErrors(result.diagnostics)).toBe(true);
        expect(
            result.diagnostics.some((diagnostic) =>
                diagnostic.message.includes("Unknown Minecraft 1.8 item: `minecraft:target`")
            )
        ).toBe(true);
    });

    it("parses a function importable with only metadata", () => {
        const result = parseImportables(caseFilePath("function_metadata_only"));

        expect(result.value.length).toBe(1);
        const fn = result.value[0];
        assertImportable(fn, "FUNCTION");
        expect(fn.name).toBe("MetadataOnlyFn");
        expect(fn.actions).toBeUndefined();
        expect(fn.description).toBe("Runs every second.");
        expect(fn.repeatTicks).toBe(20);
        expect(fn.icon).toEqual({
            item: "minecraft:map",
            count: 3,
        });
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

    it("parses a single team importable", () => {
        const result = parseImportables(caseFilePath("team"));

        expect(result.value.length).toBe(1);
        const team = result.value[0];
        assertImportable(team, "TEAM");
        expect(team.name).toBe("team tet");
        expect(team.tag).toBe("TET");
        expect(team.color).toBe("Red");
        expect(team.friendlyFire).toBe(true);
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });

    it("parses a single group importable, including tagShownInChat", () => {
        const result = parseImportables(caseFilePath("group"));

        expect(result.value.length).toBe(1);
        const group = result.value[0];
        assertImportable(group, "GROUP");
        expect(group.name).toBe("builda");
        expect(group.tag).toBe("BUILDER");
        expect(group.tagShownInChat).toBe(true);
        expect(group.color).toBe("Aqua");
        expect(group.priority).toBe(5);
        expect(group.permissions).toEqual({ "Build": true, "Use Launch Pads": false });
        expect(group.chatSpeed).toBe("Slow 3s");
        expect(group.defaultGameMode).toBe("CREATIVE");
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

describe("import.json houseUuid", () => {
    it("binds the parse to the declared house uuid, lowercased", () => {
        const result = parseImportables(caseFilePath("house_uuid"));

        expect(result.importJson.houseUuid).toBe("5e9c8f33-1234-4abc-9def-0123456789ab");
        expect(result.diagnostics.length).toBe(0);
    });

    it("leaves the parse unbound when no houseUuid is declared", () => {
        const result = parseImportables(caseFilePath("empty"));

        expect(result.importJson.houseUuid).toBe(null);
    });

    it("reports malformed house uuids", () => {
        const result = parseImportables(caseFilePath("house_uuid_invalid"));

        expect(result.importJson.houseUuid).toBe(null);
        expect(hasHardErrors(result.diagnostics)).toBe(true);
        expect(
            result.diagnostics.some((diagnostic) =>
                diagnostic.message.includes("Expected UUID")
            )
        ).toBe(true);
    });

    it("ignores houseUuid declared in an included file", () => {
        const result = parseImportables(caseDirPath("house_uuid_include"));

        expect(result.importJson.houseUuid).toBe(null);
        expect(hasHardErrors(result.diagnostics)).toBe(false);
    });
});

describe("import.json diagnostics readability", () => {
    it("reports unknown keys", () => {
        const result = parseImportables(caseFilePath("unknown_key"));
        const diag = result.diagnostics.find((it) =>
            it.message.includes("Unknown key: `oops`")
        );

        expect(diag).toBeDefined();
    });

    it("stamps sourcePath with the content file or declaring import.json", () => {
        const merged = parseImportables(caseDirPath("merge"));
        const regionPath = (name: string) =>
            merged.value.find((i) => i.type === "REGION" && i.name === name)?.sourcePath;
        expect(regionPath("RootRegion")).toBe(caseDirPath("merge"));
        expect(regionPath("SharedRegion")).toBe(
            resolve("test", "cases", "importjson", "merge", "shared.import.json")
        );

        const fn = parseImportables(caseFilePath("function")).value.find(
            (i) => i.type === "FUNCTION"
        );
        expect(fn?.sourcePath).toBe(resolve("test", "cases", "importjson", "empty.htsl"));
    });

    it("stamps per-list paths for child lists", () => {
        const result = parseImportables(caseFilePath("npc"));
        const npc = result.value.find(
            (i): i is htsw.types.ImportableNpc => i.type === "NPC"
        );

        expect(npc?.sourcePath).toBe(caseFilePath("npc"));
        expect(npc?.leftClickActionsPath).toBe(
            resolve("test", "cases", "importjson", "npc_left.htsl")
        );
        expect(npc !== undefined && htsw.importableChildListPath(npc, "rightClickActions")).toBe(
            resolve("test", "cases", "importjson", "npc_right.htsl")
        );
    });

    it("reports missing required keys", () => {
        const result = parseImportables(caseFilePath("missing_required"));
        expect(
            result.diagnostics.some((it) =>
                it.message.includes("Missing required field 'name'")
            )
        ).toBe(true);
        expect(
            result.diagnostics.some((it) =>
                it.message.includes("Missing required field 'bounds'")
            )
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

    it("reports duplicate NPC positions", () => {
        const result = parseImportables(caseFilePath("duplicate_npcs"));

        expect(hasHardErrors(result.diagnostics)).toBe(true);
        expect(
            result.diagnostics.some((diagnostic) =>
                diagnostic.message.includes("Duplicate NPC position '1,64,-2'")
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

    it("accepts known vanilla item ids", () => {
        const result = parseImportables(caseFilePath("vanilla_item_reference"));

        expect(hasHardErrors(result.diagnostics)).toBe(false);

        const resolved = htsw.items.resolveItemReference(
            result.gcx,
            new Map(),
            result.value[0],
            "minecraft:iron_block"
        );
        expect(resolved).toEqual({
            kind: "vanilla",
            key: "minecraft:iron_block",
            id: "minecraft:iron_block",
            nbt: {
                type: "compound",
                value: {
                    id: { type: "string", value: "minecraft:iron_block" },
                    Count: { type: "byte", value: 1 },
                    Damage: { type: "short", value: 0 },
                },
            },
        });
    });

    it.each([
        ["white_wool", "minecraft:wool", 0],
        ["red_wool", "minecraft:wool", 14],
        ["minecraft:white_wool", "minecraft:wool", 0],
    ])("resolves vanilla damage variation %s", (reference, id, damage) => {
        const resolved = htsw.items.resolveVanillaItemReference(reference);
        expect(resolved?.kind).toBe("vanilla");
        if (resolved?.kind !== "vanilla") return;

        expect(resolved.id).toBe(id);
        expect(resolved.nbt.value.Damage).toEqual({
            type: "short",
            value: damage,
        });
    });

    it("rejects unknown vanilla variation names", () => {
        expect(
            htsw.items.resolveVanillaItemReference("chartreuse_wool")
        ).toBeUndefined();
    });

    it.each([
        ["acacia_wood", "minecraft:log2", 0],
        ["minecraft:acacia_wood", "minecraft:log2", 0],
        ["dark_oak_wood", "minecraft:log2", 1],
        ["minecraft:dark_oak_wood", "minecraft:log2", 1],
        ["wooden_slab", "minecraft:wooden_slab", 0],
        ["minecraft:wooden_slab", "minecraft:wooden_slab", 0],
    ])("resolves overridden vanilla variation %s", (reference, id, damage) => {
        const resolved = htsw.items.resolveVanillaItemReference(reference);
        expect(resolved?.kind).toBe("vanilla");
        if (resolved?.kind !== "vanilla") return;

        expect(resolved.id).toBe(id);
        expect(resolved.nbt.value.Damage).toEqual({ type: "short", value: damage });
    });

    it("has no unresolved vanilla variation collisions", () => {
        expect(htsw.items.VANILLA_VARIATION_REFERENCE_COLLISIONS).toEqual([]);
    });

    it("reports unknown vanilla item ids distinctly", () => {
        const result = parseImportables(
            caseFilePath("unknown_vanilla_item_reference")
        );

        expect(hasHardErrors(result.diagnostics)).toBe(true);
        expect(
            result.diagnostics.some(
                (diagnostic) =>
                    diagnostic.message ===
                    "Unknown vanilla item 'minecraft:not_a_real_item'"
            )
        ).toBe(true);
        expect(
            result.diagnostics.some((diagnostic) =>
                diagnostic.message.includes("Unknown item")
            )
        ).toBe(false);
    });

    it("supports direct SNBT item paths relative to the containing HTSL file", () => {
        const result = parseImportables(caseDirPath("direct_snbt"));

        expect(hasHardErrors(result.diagnostics)).toBe(false);
        expect(result.value.length).toBe(1);
    });

    it("resolves a direct SNBT item from an explicit action-file path", () => {
        const result = parseImportables(caseDirPath("direct_snbt"));
        const sourcePath = resolve(
            "test",
            "cases",
            "importjson",
            "direct_snbt",
            "actions",
            "main.htsl"
        );

        const resolved = htsw.items.resolveItemReferenceFromSourcePath(
            result.gcx,
            new Map(),
            sourcePath,
            "items/stone.snbt"
        );

        expect(resolved?.kind).toBe("snbtPath");
        if (resolved?.kind === "snbtPath") {
            expect(resolved.path).toBe(
                resolve(dirname(sourcePath), "items", "stone.snbt")
            );
        }
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
