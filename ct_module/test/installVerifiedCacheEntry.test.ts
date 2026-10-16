import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EVENTS, type Importable } from "htsw/types";

const io = vi.hoisted(() => ({
    files: new Map<string, string>(),
    write: vi.fn<(path: string, raw: string) => boolean>(),
    mtime: 1,
}));
vi.mock("../src/utils/filesystem", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/utils/filesystem")>()),
    atomicWriteText: io.write,
    getFileMtimeMs: () => io.mtime,
}));
vi.mock("../src/importCache/hash", async (importOriginal) => {
    const original = await importOriginal<typeof import("../src/importCache/hash")>();
    return {
        ...original,
        importableHash: vi.fn(original.importableHash),
        listHashes: vi.fn(original.listHashes),
    };
});

import {
    cacheEntryHash,
    deleteImportableCache,
    getImportCacheWriteRevision,
    installVerifiedCacheEntry,
    listCachedImportables,
    peekImportableCache,
    readImportableCache,
    writeImportableCache,
    type ImportableCacheEntry,
} from "../src/importCache/cache";
import { importableHash, listHashes } from "../src/importCache/hash";
import { memoizedImportableHash } from "../src/importCache/hashMemo";
import { cachePathForId, legacyCachePathForId } from "../src/importCache/paths";
import type TaskContext from "../src/tasks/context";

const importables: Importable[] = [
    {
        type: "FUNCTION",
        name: "Function",
        actions: [
            {
                type: "CONDITIONAL",
                matchAny: false,
                conditions: [
                    { type: "COMPARE_HEALTH", op: "Equal", amount: "10", inverted: true },
                ],
                ifActions: [
                    {
                        type: "RANDOM",
                        actions: [
                            { type: "MESSAGE", message: "accepted" },
                            { type: "PAUSE", ticks: 2 },
                        ],
                    },
                ],
                elseActions: [
                    {
                        type: "CHANGE_VAR",
                        holder: { type: "Team", team: "Red" },
                        key: "score",
                        op: "Set",
                        value: "1",
                    },
                ],
            },
        ],
    },
    { type: "COMMAND", name: "command", actions: [] },
    { type: "EVENT", event: EVENTS[0], actions: [] },
    { type: "NPC", name: "NPC", pos: { x: 1, y: 2, z: 3 } },
    {
        type: "REGION",
        name: "Region",
        bounds: { from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 1, z: 1 } },
    },
    { type: "MENU", name: "Menu", slots: [] },
    {
        type: "ITEM",
        name: "Item",
        nbt: {
            type: "compound",
            value: { id: { type: "string", value: "minecraft:stone" } },
        },
    },
    { type: "TEAM", name: "Team", color: "Red" },
    { type: "GROUP", name: "Group", color: "Blue" },
];

function entry(): ImportableCacheEntry {
    return {
        schemaVersion: 2,
        version: 4,
        writtenAt: "2026-10-15T01:02:03.456Z",
        name: "Cached",
        verified: true,
        writer: "reader",
        importable: {
            type: "FUNCTION",
            name: "Cached",
            actions: [],
            icon: { item: "minecraft:stone" },
        },
        // Deliberately supplied hashes: recomputing would change these.
        hash: "0x1234",
        lists: { actions: ["0x5678"] },
        itemDependencies: {
            version: 1,
            dependencies: [
                { target: { kind: "named", name: "Wand" }, fingerprint: "0xabcd" },
            ],
        },
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

beforeEach(() => {
    vi.clearAllMocks();
    io.mtime = 1;
    io.files.clear();
    io.write.mockImplementation((path, raw) => {
        io.files.set(path, raw);
        return true;
    });
    vi.stubGlobal("FileLib", { read: (path: string) => io.files.get(path) ?? null });
    vi.stubGlobal("Java", {
        type: (name: string) => {
            if (name === "java.nio.file.Paths") return { get: (path: string) => path };
            if (name === "java.nio.file.Files")
                return {
                    exists: (path: string) =>
                        io.files.has(path) ||
                        Array.from(io.files.keys()).some((file) =>
                            file.startsWith(`${path}/`)
                        ),
                    isDirectory: () => true,
                    newDirectoryStream: (dir: string) => {
                        const paths = Array.from(io.files.keys()).filter((path) =>
                            path.startsWith(`${dir}/`)
                        );
                        let index = 0;
                        return {
                            iterator: () => ({
                                hasNext: () => index < paths.length,
                                next: () => ({
                                    getFileName: () =>
                                        paths[index++].substring(dir.length + 1),
                                }),
                            }),
                            close: () => {},
                        };
                    },
                    deleteIfExists: (path: string) => io.files.delete(path),
                };
            return {};
        },
    });
});

test.each(importables)(
    "accepts the public writer's $type format without rebuilding hashes",
    (importable) => {
        const house = `verified-format-${importable.type}`;
        expect(
            writeImportableCache(
                { displayMessage: vi.fn() } as unknown as TaskContext,
                house,
                importable,
                "exporter"
            )
        ).toBe(true);
        const [path, raw] = io.write.mock.calls[0];
        vi.clearAllMocks();

        installVerifiedCacheEntry(house, raw);

        expect(io.write).toHaveBeenCalledExactlyOnceWith(path, raw);
        expect(importableHash).not.toHaveBeenCalled();
        expect(listHashes).not.toHaveBeenCalled();
    }
);

test("replaces warm memo and enumeration, preserving exact bytes and hashes in one write", () => {
    const house = "verified-warm";
    const path = cachePathForId(house, "FUNCTION", "Cached");
    expect(listCachedImportables(house, "FUNCTION")).toEqual([]);
    writeImportableCache(
        { displayMessage: vi.fn() } as unknown as TaskContext,
        house,
        { type: "FUNCTION", name: "Cached", actions: [], description: "stale" },
        "importer"
    );
    const revision = getImportCacheWriteRevision();
    vi.clearAllMocks();
    const expected = entry();
    const raw = ` \n${JSON.stringify(expected, null, 2)}\n`;

    installVerifiedCacheEntry(house, raw);

    expect(io.write).toHaveBeenCalledExactlyOnceWith(path, raw);
    const installed = readImportableCache(house, "FUNCTION", "Cached")!;
    expect(installed).toEqual(expected);
    expect(cacheEntryHash(installed)).toBe(expected.hash);
    expect(memoizedImportableHash(installed.importable)).toBe(expected.hash);
    expect(importableHash).not.toHaveBeenCalled();
    expect(listHashes).not.toHaveBeenCalled();
    expect(getImportCacheWriteRevision()).toBe(revision + 1);
    expect(listCachedImportables(house, "FUNCTION")).toMatchObject([
        {
            name: "Cached",
            verified: true,
            importable: expected.importable,
            icon: { item: "minecraft:stone" },
        },
    ]);
    expect(io.files.get(path)).toBe(raw);

    // A disk re-read must still see the original timestamp and verified flag.
    io.mtime++;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
    expect(readImportableCache(house, "FUNCTION", "Cached")).toEqual(expected);
});

test("installs over legacy data without migrating it and supports delete/reinstall", () => {
    const house = "verified-legacy";
    const legacy = legacyCachePathForId(house, "FUNCTION", "Cached");
    io.files.set(
        legacy,
        JSON.stringify({
            ...entry(),
            verified: false,
            importable: { ...entry().importable, description: "legacy" },
        })
    );
    const raw = JSON.stringify(entry());
    installVerifiedCacheEntry(house, raw);
    expect(readImportableCache(house, "FUNCTION", "Cached")?.verified).toBe(true);
    expect(io.files.has(legacy)).toBe(true);
    expect(listCachedImportables(house, "FUNCTION")).toMatchObject([
        { name: "Cached", verified: true, importable: entry().importable },
    ]);
    expect(listCachedImportables(house, "FUNCTION")).toHaveLength(1);
    expect(listCachedImportables(house, "FUNCTION")[0].importable).toEqual(
        entry().importable
    );
    expect(deleteImportableCache(house, "FUNCTION", "Cached")).toBe(true);
    // The legacy record must not return after deleting the installed baseline.
    expect(readImportableCache(house, "FUNCTION", "Cached")).toBeNull();
    installVerifiedCacheEntry(house, raw);
    expect(readImportableCache(house, "FUNCTION", "Cached")).toEqual(entry());
});

test.each([
    { verified: false },
    { verified: undefined },
    { importable: undefined },
    { schemaVersion: 1 },
    { version: 3 },
    { version: undefined },
    { name: "Wrong identity" },
    { hash: "" },
    { writer: "unknown" },
    { writtenAt: "invalid" },
    { lists: [] },
    { lists: { actions: [123] } },
    { importable: [] },
    { importable: { type: "UNKNOWN", name: "Cached" } },
    { importable: { type: "FUNCTION", name: "Cached", actions: "bad" } },
    ...[
        [null],
        [[]],
        [false],
        [{ type: "UNKNOWN" }],
        [{ type: "constructor" }],
        [{ type: "__proto__" }],
        [{ type: "MESSAGE" }],
        [{ type: "MESSAGE", message: 123 }],
        [{ type: "PAUSE", ticks: "2" }],
        [{ type: "FUNCTION", function: "work", global: "true" }],
        [{ type: "MESSAGE", message: "ok", note: false }],
        [{ type: "RANDOM", actions: [null] }],
        [{ type: "RANDOM", actions: {} }],
        [
            {
                type: "CONDITIONAL",
                matchAny: false,
                conditions: [null],
                ifActions: [],
                elseActions: [],
            },
        ],
        [
            {
                type: "CONDITIONAL",
                matchAny: false,
                conditions: [{ type: "UNKNOWN" }],
                ifActions: [],
                elseActions: [],
            },
        ],
        [
            {
                type: "CONDITIONAL",
                matchAny: false,
                conditions: [{ type: "COMPARE_HEALTH", amount: 10 }],
                ifActions: [],
                elseActions: [],
            },
        ],
        [
            {
                type: "CONDITIONAL",
                matchAny: false,
                conditions: [{ type: "IS_FLYING", inverted: "false" }],
                ifActions: [],
                elseActions: [],
            },
        ],
        [
            {
                type: "CONDITIONAL",
                matchAny: "false",
                conditions: [],
                ifActions: [],
                elseActions: [],
            },
        ],
        [
            {
                type: "CONDITIONAL",
                matchAny: false,
                conditions: [],
                ifActions: null,
                elseActions: [],
            },
        ],
        [{ type: "TELEPORT", location: { type: "Custom Coordinates", value: 10 } }],
        [
            {
                type: "CHANGE_VAR",
                holder: { type: "Team", team: 1 },
                key: "x",
                op: "Set",
                value: "1",
            },
        ],
    ].map((actions) => ({ importable: { type: "FUNCTION", name: "Cached", actions } })),
    { importable: { type: "MENU", name: "Cached", slots: [null] } },
    {
        importable: {
            type: "MENU",
            name: "Cached",
            slots: [{ slot: 1, nbt: {}, actions: [null] }],
        },
    },
    {
        importable: {
            type: "REGION",
            name: "Cached",
            bounds: { from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 1, z: 1 } },
            onEnterActions: [null],
        },
    },
    { importable: { type: "ITEM", name: "Cached", nbt: {}, rightClickActions: [null] } },
    { itemDependencies: null },
    { itemDependencies: { version: 1, dependencies: [null] } },
    {
        itemDependencies: {
            version: 1,
            dependencies: [{ fingerprint: "0x12", target: { kind: "unknown" } }],
        },
    },
])(
    "refuses malformed or unverified entries without writing or publishing: %j",
    (overrides) => {
        const house = "verified-rejected";
        const revision = getImportCacheWriteRevision();
        expect(() =>
            installVerifiedCacheEntry(house, JSON.stringify({ ...entry(), ...overrides }))
        ).toThrow("Invalid verified cache entry");
        expect(io.write).not.toHaveBeenCalled();
        expect(importableHash).not.toHaveBeenCalled();
        expect(listHashes).not.toHaveBeenCalled();
        expect(peekImportableCache(house, "FUNCTION", "Cached")).toEqual({
            loaded: false,
        });
        expect(listCachedImportables(house, "FUNCTION")).toEqual([]);
        expect(getImportCacheWriteRevision()).toBe(revision);
    }
);

test("refuses invalid JSON and unsafe housing paths", () => {
    for (const raw of ["{", "null", "[]"]) {
        expect(() => installVerifiedCacheEntry("verified-json", raw)).toThrow(
            "Invalid verified cache entry"
        );
    }
    expect(() => installVerifiedCacheEntry("../escape", JSON.stringify(entry()))).toThrow(
        "Invalid cache housing UUID"
    );
    expect(io.write).not.toHaveBeenCalled();
});

test("a failed write leaves the old memo, enumeration and revision intact", () => {
    const house = "verified-write-failed";
    const original = entry();
    installVerifiedCacheEntry(house, JSON.stringify(original));
    const old = readImportableCache(house, "FUNCTION", "Cached");
    const rows = listCachedImportables(house, "FUNCTION");
    const revision = getImportCacheWriteRevision();
    io.write.mockReturnValue(false);
    expect(() =>
        installVerifiedCacheEntry(house, JSON.stringify({ ...original, hash: "0xabcd" }))
    ).toThrow("Could not install cache");
    expect(readImportableCache(house, "FUNCTION", "Cached")).toEqual(old);
    expect(listCachedImportables(house, "FUNCTION")).toEqual(rows);
    expect(getImportCacheWriteRevision()).toBe(revision);
});
