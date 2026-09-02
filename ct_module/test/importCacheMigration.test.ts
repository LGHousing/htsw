import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportableFunction } from "htsw/types";

vi.mock("../src/utils/filesystem", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/utils/filesystem")>()),
    getFileMtimeMs: () => 1,
}));

import { readImportableCache } from "../src/importCache/cache";
import {
    cachePathForId,
    legacyCachePathForId,
} from "../src/importCache/paths";

function entry(name: string): string {
    const importable: ImportableFunction = { type: "FUNCTION", name, actions: [] };
    return JSON.stringify({
        schemaVersion: 2,
        writtenAt: "2026-09-02T00:00:00.000Z",
        name,
        writer: "importer",
        importable,
        hash: "hash",
        lists: {},
    });
}

function stubFilesystem(files: Map<string, string>): {
    exists: ReturnType<typeof vi.fn>;
    move: ReturnType<typeof vi.fn>;
} {
    const exists = vi.fn((path: string) => files.has(path));
    const move = vi.fn((source: string, target: string) => {
        const content = files.get(source);
        if (content === undefined) throw new Error("missing");
        files.delete(source);
        files.set(target, content);
    });
    vi.stubGlobal("Java", {
        type: (name: string) => {
            if (name === "java.nio.file.Paths") return { get: (path: string) => path };
            if (name === "java.nio.file.Files") return { exists, move };
            return {};
        },
    });
    vi.stubGlobal("FileLib", {
        read: (path: string) => files.get(path) ?? null,
    });
    return { exists, move };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("legacy import cache migration", () => {
    it("moves and reads a legacy file whose identity matches exactly", () => {
        const identity = "Migration Match";
        const legacy = legacyCachePathForId("migration-house", "FUNCTION", identity);
        const current = cachePathForId("migration-house", "FUNCTION", identity);
        const files = new Map([[legacy, entry(identity)]]);
        const io = stubFilesystem(files);

        expect(readImportableCache("migration-house", "FUNCTION", identity)?.name).toBe(
            identity
        );
        expect(files.has(legacy)).toBe(false);
        expect(files.has(current)).toBe(true);
        expect(io.move).toHaveBeenCalledWith(legacy, current);

        const statCount = io.exists.mock.calls.length;
        readImportableCache("migration-house", "FUNCTION", identity);
        expect(io.exists).toHaveBeenCalledTimes(statCount);
    });

    it("leaves a case-collision sibling in place and returns no cache", () => {
        const identity = "Migration Case";
        const legacy = legacyCachePathForId("collision-house", "FUNCTION", identity);
        const current = cachePathForId("collision-house", "FUNCTION", identity);
        const files = new Map([[legacy, entry("migration case")]]);
        const io = stubFilesystem(files);

        expect(readImportableCache("collision-house", "FUNCTION", identity)).toBeNull();
        expect(files.has(legacy)).toBe(true);
        expect(files.has(current)).toBe(false);
        expect(io.move).not.toHaveBeenCalled();
    });
});
