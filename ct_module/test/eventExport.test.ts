import { describe, expect, it } from "vitest";
import type { ProjectFs } from "htsw-editor-common/project";

import { removeEmptyEventExport } from "../src/importables/events/readHouseEvents";

function memoryFs(
    files: Record<string, string>
): ProjectFs & { store: Map<string, string> } {
    const store = new Map(Object.entries(files));
    const normalize = (path: string): string => {
        const parts = path.replace(/\\/g, "/").split("/");
        const normalized: string[] = [];
        for (let i = 0; i < parts.length; i++) {
            if (parts[i] === "" || parts[i] === ".") continue;
            if (parts[i] === "..") normalized.pop();
            else normalized.push(parts[i]);
        }
        return `/${normalized.join("/")}`;
    };
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

const IMPORT_JSON = "/project/import.json";

describe("event exports", () => {
    it("removes an earlier export when the live event becomes empty", () => {
        const fs = memoryFs({
            [IMPORT_JSON]: JSON.stringify({
                events: [{ event: "Player Join", actions: "join.htsl" }],
            }),
            "/project/join.htsl": "sendMessage old",
        });

        removeEmptyEventExport(fs, IMPORT_JSON, "Player Join");

        expect(JSON.parse(fs.readFile(IMPORT_JSON))).toEqual({});
        expect(fs.exists("/project/join.htsl")).toBe(false);
    });

    it("preserves an action file shared with another event", () => {
        const fs = memoryFs({
            [IMPORT_JSON]: JSON.stringify({
                events: [
                    { event: "Player Join", actions: "shared.htsl" },
                    { event: "Player Quit", actions: "shared.htsl" },
                ],
            }),
            "/project/shared.htsl": "sendMessage shared",
        });

        removeEmptyEventExport(fs, IMPORT_JSON, "Player Join");

        expect(JSON.parse(fs.readFile(IMPORT_JSON))).toEqual({
            events: [{ event: "Player Quit", actions: "shared.htsl" }],
        });
        expect(fs.exists("/project/shared.htsl")).toBe(true);
    });

    it("preserves an owned action file outside the project", () => {
        const fs = memoryFs({
            [IMPORT_JSON]: JSON.stringify({
                events: [{ event: "Player Join", actions: "../outside/leak.htsl" }],
            }),
            "/outside/leak.htsl": "sendMessage outside",
        });

        removeEmptyEventExport(fs, IMPORT_JSON, "Player Join");

        expect(JSON.parse(fs.readFile(IMPORT_JSON))).toEqual({});
        expect(fs.exists("/outside/leak.htsl")).toBe(true);
    });
});
