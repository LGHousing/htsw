import { describe, expect, test } from "vitest";
import {
    createEmptyProjectFiles,
    createIncludedFolderInTree,
    htslTargetForFunctionExport,
    moveImportableEntry,
    projectSectionFolders,
    restructureProjectPerSection,
    snbtTargetForItemExport,
    type ProjectFs,
} from "htsw-editor-common/project";

function normalize(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function parentDir(path: string): string {
    const normalized = normalize(path);
    const slash = normalized.lastIndexOf("/");
    if (slash < 0) return ".";
    if (slash === 0) return "/";
    return normalized.substring(0, slash);
}

function memoryFs(files: Record<string, string>): ProjectFs & { store: Map<string, string> } {
    const store = new Map<string, string>();
    for (const path of Object.keys(files)) store.set(normalize(path), files[path]);
    return {
        store,
        exists: (path) => store.has(normalize(path)),
        readFile: (path) => {
            const value = store.get(normalize(path));
            if (value === undefined) throw new Error(`Missing file: ${path}`);
            return value;
        },
        writeFile: (path, text) => {
            store.set(normalize(path), text);
        },
        ensureDir: () => undefined,
        parentDir,
        resolvePath: (baseDir, ref) => {
            const normalizedRef = normalize(ref);
            if (normalizedRef.charAt(0) === "/") return normalizedRef;
            return normalize(`${baseDir}/${normalizedRef}`);
        },
        deleteFile: (path) => {
            store.delete(normalize(path));
        },
    };
}

const ROOT = "/project/import.json";

describe("section folder export routing", () => {
    test("new function routes to functions/import.json when included", () => {
        const fs = memoryFs({
            [ROOT]: JSON.stringify({ include: ["functions/import.json"] }),
            "/project/functions/import.json": "{}",
        });

        const target = htslTargetForFunctionExport(fs, ROOT, "My Function");
        expect(target.importJsonPath).toBe("/project/functions/import.json");
        expect(target.htslReference).toBe("My_Function.htsl");
        expect(target.htslPath).toBe("/project/functions/My_Function.htsl");
    });

    test("new function falls back to the entry file without a section include", () => {
        const fs = memoryFs({ [ROOT]: "{}" });

        const target = htslTargetForFunctionExport(fs, ROOT, "My Function");
        expect(target.importJsonPath).toBe(ROOT);
    });

    test("a functions folder on disk but not included is ignored", () => {
        const fs = memoryFs({
            [ROOT]: "{}",
            "/project/functions/import.json": "{}",
        });

        const target = htslTargetForFunctionExport(fs, ROOT, "My Function");
        expect(target.importJsonPath).toBe(ROOT);
    });

    test("the declaring file wins over the section folder", () => {
        const fs = memoryFs({
            [ROOT]: JSON.stringify({
                include: ["functions/import.json", "custom/import.json"],
            }),
            "/project/functions/import.json": "{}",
            "/project/custom/import.json": JSON.stringify({
                functions: [{ name: "My Function", actions: "mine.htsl" }],
            }),
            "/project/custom/mine.htsl": "chat \"hi\"",
        });

        const target = htslTargetForFunctionExport(fs, ROOT, "My Function");
        expect(target.importJsonPath).toBe("/project/custom/import.json");
        expect(target.htslReference).toBe("mine.htsl");
    });

    test("new item routes beside items/import.json without nesting items/items/", () => {
        const fs = memoryFs({
            [ROOT]: JSON.stringify({ include: ["items/import.json"] }),
            "/project/items/import.json": "{}",
        });

        const target = snbtTargetForItemExport(fs, ROOT, "/project", "Wand");
        expect(target.importJsonPath).toBe("/project/items/import.json");
        expect(target.snbtReference).toBe("Wand.snbt");
        expect(target.snbtPath).toBe("/project/items/Wand.snbt");
    });
});

describe("moveImportableEntry into a folder already holding the files", () => {
    test("shortens references instead of nesting the files deeper", () => {
        const fs = memoryFs({
            [ROOT]: JSON.stringify({
                include: ["menus/import.json"],
                menus: [
                    {
                        name: "Shop",
                        slots: [{ slot: 0, nbt: "items/coin.snbt", actions: "menus/shop/slot-0.htsl" }],
                    },
                ],
            }),
            "/project/menus/import.json": "{}",
            "/project/menus/shop/slot-0.htsl": "chat \"buy\"",
            "/project/items/coin.snbt": "{}",
        });

        const result = moveImportableEntry(fs, ROOT, "menus", "Shop", "/project/menus/import.json");
        expect(result.ok).toBe(true);

        // The slot htsl already lived under menus/ — it must not become
        // menus/menus/shop/slot-0.htsl.
        expect(fs.store.has("/project/menus/shop/slot-0.htsl")).toBe(true);
        expect(fs.store.has("/project/menus/menus/shop/slot-0.htsl")).toBe(false);
        const dest = JSON.parse(fs.readFile("/project/menus/import.json"));
        expect(dest.menus[0].slots[0].actions).toBe("shop/slot-0.htsl");
        // The item snbt was NOT under menus/, so it copies in normally.
        expect(dest.menus[0].slots[0].nbt).toBe("items/coin.snbt");
        expect(fs.store.has("/project/menus/items/coin.snbt")).toBe(true);
    });
});

describe("restructureProjectPerSection", () => {
    test("creates section includes and moves root importables into them", () => {
        const fs = memoryFs({
            [ROOT]: JSON.stringify({
                functions: [{ name: "Hello", actions: "hello.htsl" }],
                events: [{ event: "Player Join", actions: "join.htsl" }],
                items: [{ name: "Wand", nbt: "items/wand.snbt" }],
            }),
            "/project/hello.htsl": "chat \"hello\"",
            "/project/join.htsl": "chat \"welcome\"",
            "/project/items/wand.snbt": "{}",
        });

        const result = restructureProjectPerSection(fs, ROOT);
        expect(result.failures).toEqual([]);
        expect(result.moved.length).toBe(3);

        const root = JSON.parse(fs.readFile(ROOT));
        expect(root.include).toContain("functions/import.json");
        expect(root.include).toContain("items/import.json");
        expect(root.functions ?? []).toEqual([]);
        expect(root.events ?? []).toEqual([]);
        expect(root.items ?? []).toEqual([]);

        const functions = JSON.parse(fs.readFile("/project/functions/import.json"));
        expect(functions.functions[0]).toEqual({ name: "Hello", actions: "hello.htsl" });
        expect(fs.store.has("/project/functions/hello.htsl")).toBe(true);
        expect(fs.store.has("/project/hello.htsl")).toBe(false);

        const items = JSON.parse(fs.readFile("/project/items/import.json"));
        // wand.snbt already lived under items/ — reference shortens in place.
        expect(items.items[0]).toEqual({ name: "Wand", nbt: "wand.snbt" });
        expect(fs.store.has("/project/items/wand.snbt")).toBe(true);

        expect(projectSectionFolders(fs, ROOT).length).toBeGreaterThan(0);

        // New exports now route into the folders.
        const target = htslTargetForFunctionExport(fs, ROOT, "Another");
        expect(target.importJsonPath).toBe("/project/functions/import.json");
    });

    test("leaves importables the user already placed in other includes", () => {
        const fs = memoryFs({
            [ROOT]: JSON.stringify({
                include: ["custom/import.json"],
                functions: [{ name: "Root Fn", actions: "root_fn.htsl" }],
            }),
            "/project/root_fn.htsl": "chat \"root\"",
            "/project/custom/import.json": JSON.stringify({
                functions: [{ name: "Custom Fn", actions: "custom_fn.htsl" }],
            }),
            "/project/custom/custom_fn.htsl": "chat \"custom\"",
        });

        const result = restructureProjectPerSection(fs, ROOT);
        expect(result.failures).toEqual([]);
        expect(result.moved).toEqual([{ section: "functions", identity: "Root Fn" }]);

        const custom = JSON.parse(fs.readFile("/project/custom/import.json"));
        expect(custom.functions[0].name).toBe("Custom Fn");
        expect(fs.store.has("/project/custom/custom_fn.htsl")).toBe(true);
    });

    test("running it twice adds no duplicate includes", () => {
        const fs = memoryFs({
            [ROOT]: JSON.stringify({
                functions: [{ name: "Hello", actions: "hello.htsl" }],
            }),
            "/project/hello.htsl": "chat \"hello\"",
        });

        restructureProjectPerSection(fs, ROOT);
        const second = restructureProjectPerSection(fs, ROOT);
        expect(second.createdIncludes).toEqual([]);
        expect(second.moved).toEqual([]);

        const root = JSON.parse(fs.readFile(ROOT));
        const functionIncludes = (root.include as string[]).filter(
            (ref) => ref === "functions/import.json"
        );
        expect(functionIncludes.length).toBe(1);
    });
});

describe("createIncludedFolderInTree", () => {
    test("hangs the new include off the deepest containing import.json", () => {
        const fs = memoryFs({
            [ROOT]: JSON.stringify({ include: ["functions/import.json"] }),
            "/project/functions/import.json": "{}",
        });

        const result = createIncludedFolderInTree(fs, ROOT, "functions/combat");
        expect(result.importJsonPath).toBe("/project/functions/combat/import.json");
        expect(result.parentImportJsonPath).toBe("/project/functions/import.json");
        expect(result.includePath).toBe("combat/import.json");
        expect(fs.readFile("/project/functions/combat/import.json")).toBe("{}\n");
        const parent = JSON.parse(fs.readFile("/project/functions/import.json"));
        expect(parent.include).toEqual(["combat/import.json"]);
    });

    test("includes from the root when no deeper file contains the folder", () => {
        const fs = memoryFs({ [ROOT]: "{}" });

        const result = createIncludedFolderInTree(fs, ROOT, "combat");
        expect(result.parentImportJsonPath).toBe(ROOT);
        const root = JSON.parse(fs.readFile(ROOT));
        expect(root.include).toEqual(["combat/import.json"]);
    });

    test("rejects a folder that already has an import.json", () => {
        const fs = memoryFs({
            [ROOT]: JSON.stringify({ include: ["combat/import.json"] }),
            "/project/combat/import.json": "{}",
        });

        expect(() => createIncludedFolderInTree(fs, ROOT, "combat")).toThrow(
            /already exists/
        );
    });

    test("moving into the fresh folder then routes files under it", () => {
        const fs = memoryFs({
            [ROOT]: JSON.stringify({
                functions: [{ name: "Duel", actions: "duel.htsl" }],
            }),
            "/project/duel.htsl": "chat \"fight\"",
        });

        const created = createIncludedFolderInTree(fs, ROOT, "functions/combat");
        const moved = moveImportableEntry(fs, ROOT, "functions", "Duel", created.importJsonPath);
        expect(moved.ok).toBe(true);
        expect(fs.store.has("/project/functions/combat/duel.htsl")).toBe(true);
        expect(fs.store.has("/project/duel.htsl")).toBe(false);
        const combat = JSON.parse(fs.readFile("/project/functions/combat/import.json"));
        expect(combat.functions[0]).toEqual({ name: "Duel", actions: "duel.htsl" });
    });
});

describe("createEmptyProjectFiles with section folders", () => {
    test("scaffolds an include per exportable section", () => {
        const fs = memoryFs({});

        const result = createEmptyProjectFiles(fs, "/projects", "mygame", {
            sectionFolders: true,
        });
        expect(result.created).toBe(true);

        const root = JSON.parse(fs.readFile("/projects/mygame/import.json"));
        expect(root.include).toContain("functions/import.json");
        expect(root.include).toContain("events/import.json");
        expect(fs.store.has("/projects/mygame/functions/import.json")).toBe(true);
        expect(projectSectionFolders(fs, "/projects/mygame/import.json")).toContain("functions");
    });

    test("defaults to the flat layout when no option is passed", () => {
        const fs = memoryFs({});

        createEmptyProjectFiles(fs, "/projects", "flatgame");
        const root = JSON.parse(fs.readFile("/projects/flatgame/import.json"));
        expect(root.include).toBeUndefined();
    });
});
