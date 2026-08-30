import { describe, expect, test } from "vitest";
import {
    removeImportableEntryForDelete,
    type ProjectFs,
} from "htsw-editor-common/project";

function normalize(path: string): string {
    const parts: string[] = [];
    for (const part of path.replace(/\\/g, "/").split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") parts.pop();
        else parts.push(part);
    }
    return `/${parts.join("/")}`;
}

function memoryFs(
    files: Record<string, unknown>
): ProjectFs & { store: Map<string, string> } {
    const store = new Map<string, string>();
    for (const path of Object.keys(files)) {
        store.set(normalize(path), `${JSON.stringify(files[path], null, 4)}\n`);
    }
    return {
        store,
        exists: (path) => store.has(normalize(path)),
        readFile: (path) => {
            const value = store.get(normalize(path));
            if (value === undefined) throw new Error(`Missing file: ${path}`);
            return value;
        },
        writeFile: (path, text) => store.set(normalize(path), text),
        ensureDir: () => undefined,
        parentDir: (path) => normalize(path).replace(/\/[^/]+$/, "") || "/",
        resolvePath: (baseDir, ref) => normalize(`${baseDir}/${ref}`),
        pathKey: normalize,
        deleteFile: (path) => {
            store.delete(normalize(path));
        },
    };
}

const ROOT = "/project/import.json";
const FUNCTIONS = "/project/functions/import.json";

describe("delete importable", () => {
    test("removes a metadata-only function without touching sibling functions", () => {
        const fs = memoryFs({
            [ROOT]: { include: ["functions/import.json"] },
            [FUNCTIONS]: {
                functions: [
                    { name: "Delete me" },
                    { name: "Keep me", actions: "keep.htsl" },
                ],
            },
            "/project/functions/keep.htsl": "sendMessage Keep me",
        });

        const result = removeImportableEntryForDelete(fs, ROOT, "functions", "Delete me");

        expect(result).toMatchObject({
            ok: true,
            ownedFiles: [],
            prunedImportJsonFiles: [],
        });
        expect(JSON.parse(fs.readFile(FUNCTIONS))).toEqual({
            functions: [{ name: "Keep me", actions: "keep.htsl" }],
        });
        expect(fs.exists("/project/functions/keep.htsl")).toBe(true);
        expect(JSON.parse(fs.readFile(ROOT))).toEqual({
            include: ["functions/import.json"],
        });
    });

    test("deletes a nested manifest and detaches it when its last entry is removed", () => {
        const fs = memoryFs({
            [ROOT]: { include: ["functions/import.json"] },
            [FUNCTIONS]: { functions: [{ name: "Only function" }] },
        });

        const result = removeImportableEntryForDelete(
            fs,
            ROOT,
            "functions",
            "Only function"
        );

        expect(result).toMatchObject({ ok: true, prunedImportJsonFiles: [FUNCTIONS] });
        expect(fs.exists(FUNCTIONS)).toBe(false);
        expect(JSON.parse(fs.readFile(ROOT))).toEqual({ include: [] });
    });

    test("prunes empty nested manifests up to but not including the project root", () => {
        const nested = "/project/functions/combat/import.json";
        const fs = memoryFs({
            [ROOT]: { include: ["functions/import.json"] },
            [FUNCTIONS]: { include: ["combat/import.json"] },
            [nested]: { functions: [{ name: "Only function" }] },
        });

        const result = removeImportableEntryForDelete(
            fs,
            ROOT,
            "functions",
            "Only function"
        );

        expect(result).toMatchObject({
            ok: true,
            prunedImportJsonFiles: [nested, FUNCTIONS],
        });
        expect(fs.exists(nested)).toBe(false);
        expect(fs.exists(FUNCTIONS)).toBe(false);
        expect(fs.exists(ROOT)).toBe(true);
        expect(JSON.parse(fs.readFile(ROOT))).toEqual({ include: [] });
    });

    test("keeps the root manifest and nested manifests with other metadata", () => {
        const nestedFs = memoryFs({
            [ROOT]: { include: ["functions/import.json"] },
            [FUNCTIONS]: {
                note: "keep this manifest",
                functions: [{ name: "Only function" }],
            },
        });
        const rootFs = memoryFs({
            [ROOT]: { functions: [{ name: "Root function" }] },
        });

        const nestedResult = removeImportableEntryForDelete(
            nestedFs,
            ROOT,
            "functions",
            "Only function"
        );
        const rootResult = removeImportableEntryForDelete(
            rootFs,
            ROOT,
            "functions",
            "Root function"
        );

        expect(nestedResult).toMatchObject({ ok: true, prunedImportJsonFiles: [] });
        expect(JSON.parse(nestedFs.readFile(FUNCTIONS))).toEqual({
            note: "keep this manifest",
        });
        expect(rootResult).toMatchObject({ ok: true, prunedImportJsonFiles: [] });
        expect(rootFs.exists(ROOT)).toBe(true);
        expect(JSON.parse(rootFs.readFile(ROOT))).toEqual({});
    });
});
