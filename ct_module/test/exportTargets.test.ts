import { describe, expect, test } from "vitest";
import {
    moveImportableEntry,
    npcExportReferencesExist,
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

function memoryFs(files: Record<string, string>): ProjectFs {
    const store = new Map<string, string>();
    for (const path of Object.keys(files)) store.set(normalize(path), files[path]);
    return {
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
        pathKey: normalize,
    };
}

describe("npcExportReferencesExist", () => {
    test("accepts NPC entries with no action references", () => {
        const fs = memoryFs({
            "/project/import.json": JSON.stringify({
                npcs: [
                    { name: "Guide", pos: { x: 1, y: 2, z: 3 } },
                ],
            }),
        });

        expect(npcExportReferencesExist(fs, "/project/import.json", { x: 1, y: 2, z: 3 }))
            .toBe(true);
    });

    test("requires declared NPC action references to exist", () => {
        const fs = memoryFs({
            "/project/import.json": JSON.stringify({
                npcs: [
                    {
                        name: "Guide",
                        pos: { x: 1, y: 2, z: 3 },
                        leftClickActions: "guide_left.htsl",
                    },
                ],
            }),
            "/project/guide_left.htsl": "",
        });

        expect(npcExportReferencesExist(fs, "/project/import.json", { x: 1, y: 2, z: 3 }))
            .toBe(true);
    });

    test("rejects declared NPC action references with missing files", () => {
        const fs = memoryFs({
            "/project/import.json": JSON.stringify({
                npcs: [
                    {
                        name: "Guide",
                        pos: { x: 1, y: 2, z: 3 },
                        leftClickActions: "missing.htsl",
                    },
                ],
            }),
        });

        expect(npcExportReferencesExist(fs, "/project/import.json", { x: 1, y: 2, z: 3 }))
            .toBe(false);
    });
});

describe("moveImportableEntry", () => {
    test("moves NPC entries by position identity", () => {
        const fs = memoryFs({
            "/project/import.json": JSON.stringify({
                include: ["npcs.import.json", "dest.import.json"],
            }),
            "/project/npcs.import.json": JSON.stringify({
                npcs: [
                    {
                        name: "Guide",
                        pos: { x: 1, y: 64, z: -2 },
                        leftClickActions: "guide_left.htsl",
                    },
                ],
            }),
            "/project/dest.import.json": JSON.stringify({ npcs: [] }),
            "/project/guide_left.htsl": "chat \"left\"\n",
        });

        const result = moveImportableEntry(
            fs,
            "/project/import.json",
            "npcs",
            "1,64,-2",
            "/project/dest.import.json"
        );

        expect(result.ok).toBe(true);
        const dest = JSON.parse(fs.readFile("/project/dest.import.json")) as {
            npcs: Array<{
                name: string;
                pos: { x: number; y: number; z: number };
                leftClickActions: string;
            }>;
        };
        expect(dest.npcs).toEqual([
            {
                name: "Guide",
                pos: { x: 1, y: 64, z: -2 },
                leftClickActions: "guide_left.htsl",
            },
        ]);
        const source = JSON.parse(
            fs.readFile("/project/npcs.import.json")
        ) as Record<string, unknown>;
        expect(source).not.toHaveProperty("npcs");
    });
});
