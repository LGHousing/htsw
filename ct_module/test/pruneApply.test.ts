import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Importable } from "htsw/types";
import type { ImportablesParseResult } from "htsw";

const mocks = vi.hoisted(() => ({
    deletedFunctions: [] as string[],
    functionDeleteError: null as string | null,
    importSessions: [] as Importable[][],
    importSessionError: null as string | null,
    cacheDeletes: [] as string[],
    cached: new Map<string, Importable>(),
    liveReads: new Map<string, Importable>(),
    readCalls: [] as string[],
}));

vi.mock("../src/importables/functions/listFunctions", () => ({
    listAllFunctionNames: async () => [],
}));
vi.mock("../src/importables/menus/listMenus", () => ({
    listAllMenuNames: async () => [],
}));
vi.mock("../src/importables/regions/listRegions", () => ({
    listAllRegionNames: async () => [],
}));
vi.mock("../src/importables/commands/listCommands", () => ({
    listAllCommandNames: async () => [],
}));
vi.mock("../src/importables/teams/listTeams", () => ({
    listAllTeamNames: async () => [],
    deleteTeam: async () => undefined,
}));
vi.mock("../src/importables/groups/listGroups", () => ({
    listAllGroupNames: async () => [],
    deleteGroup: async () => undefined,
}));
vi.mock("../src/importables/npcs/listNpcs", () => ({
    listAllNpcs: async () => [],
    npcLabel: () => "NPC",
}));
vi.mock("../src/importCache/cache", () => ({
    recordHouseScan: () => undefined,
    listCachedImportables: () => [],
    readImportableCache: (_uuid: string, type: string, identity: string) => {
        const importable = mocks.cached.get(`${type}:${identity}`);
        if (importable === undefined) return null;
        return { verified: true, importable };
    },
    deleteImportableCache: (_uuid: string, type: string, identity: string) => {
        mocks.cacheDeletes.push(`${type}:${identity}`);
        return true;
    },
}));
vi.mock("../src/importables/import/session", () => ({
    runImportSession: async (
        _ctx: unknown,
        request: { importables: Importable[] }
    ) => {
        if (mocks.importSessionError !== null) {
            throw new Error(mocks.importSessionError);
        }
        mocks.importSessions.push(request.importables);
    },
}));
vi.mock("../src/importables/export/readers", () => ({
    HOUSE_READERS: new Proxy(
        {},
        {
            get: (_target, type: string) =>
                async (
                    _ctx: unknown,
                    options: {
                        names?: readonly string[];
                        output: {
                            accept: (importable: Importable, content: unknown) => void;
                        };
                    }
                ) => {
                    const name = options.names?.[0] ?? "";
                    mocks.readCalls.push(`${type}:${name}`);
                    const live = mocks.liveReads.get(`${type}:${name}`);
                    if (live !== undefined) options.output.accept(live, {});
                    return { total: 1, succeeded: 1, failed: 0 };
                },
        }
    ),
}));
vi.mock("../src/importables/export/projectDestination", () => ({
    projectItemsFromParsedImportJson: () => [],
}));

import { applyPrunePlan } from "../src/prune/apply";
import { readHouseLock } from "../src/importCache/houseLock";
import type TaskContext from "../src/tasks/context";
import type { PruneTarget } from "../src/prune/types";

const manifestPath = "./projects/demo/import.json";
const lockPath = "./projects/demo/house.lock.json";
const HOUSE = "house-1";

const ctx = { checkCancelled: () => undefined } as unknown as TaskContext;
const parsed = { value: [], gcx: {} } as unknown as ImportablesParseResult;

let files: Partial<Record<string, string>> = {};

function stubFiles(lockEntries: { type: string; identity: string }[]): void {
    files = {};
    const importables: Record<string, unknown> = {};
    for (const entry of lockEntries) {
        importables[`${entry.type}:${entry.identity}`] = {
            type: entry.type,
            identity: entry.identity,
            hash: "0xhash",
        };
    }
    files[lockPath] = JSON.stringify({
        schemaVersion: 1,
        houseUuid: HOUSE,
        importables,
    });
    vi.stubGlobal("FileLib", {
        exists: (path: string) => files[path] !== undefined,
        read: (path: string) => files[path] ?? null,
        write: (path: string, content: string) => {
            files[path] = content;
        },
    });
}

function target(overrides: Partial<PruneTarget> = {}): PruneTarget {
    return {
        type: "FUNCTION",
        identity: "Leftover",
        label: "Leftover",
        method: "delete",
        owned: true,
        ...overrides,
    };
}

function apply(targets: PruneTarget[], rescue = false) {
    return applyPrunePlan(ctx, targets, {
        manifestPath,
        housingUuid: HOUSE,
        parsed,
        rescue,
    });
}

// the most recent record, so a test that prunes twice reads the second one
function recordFile(): Record<string, unknown> {
    const paths = Object.keys(files).filter(
        (name) => name.indexOf("/htsw/pruned/") >= 0
    );
    if (paths.length === 0) throw new Error("no prune record was written");
    return JSON.parse(files[paths[paths.length - 1]] ?? "") as Record<string, unknown>;
}

beforeEach(() => {
    mocks.deletedFunctions = [];
    mocks.functionDeleteError = null;
    mocks.importSessions = [];
    mocks.importSessionError = null;
    mocks.cacheDeletes = [];
    mocks.cached = new Map();
    mocks.liveReads = new Map();
    mocks.readCalls = [];
    stubFiles([]);
    vi.stubGlobal("ChatLib", { chat: () => undefined, command: () => undefined });
    vi.stubGlobal("Java", { type: () => new Proxy({}, { get: () => () => undefined }) });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// the registry runs `/function delete` through the task context, so record
// the commands instead of sending them
function commandRecordingCtx(): TaskContext {
    return {
        checkCancelled: () => undefined,
        runCommand: async (command: string) => {
            if (mocks.functionDeleteError !== null) {
                throw new Error(mocks.functionDeleteError);
            }
            mocks.deletedFunctions.push(command);
        },
    } as unknown as TaskContext;
}

describe("applyPrunePlan", () => {
    it("does nothing and writes no record for an empty plan", async () => {
        const result = await apply([]);

        expect(result.removed).toEqual([]);
        expect(result.recordPath).toBe(null);
        expect(Object.keys(files).some((n) => n.indexOf("pruned-") >= 0)).toBe(false);
    });

    it("deletes each target through its type's removal command", async () => {
        const result = await applyPrunePlan(
            commandRecordingCtx(),
            [target({ identity: "One" }), target({ identity: "Two" })],
            { manifestPath, housingUuid: HOUSE, parsed }
        );

        expect(mocks.deletedFunctions).toEqual([
            "/function delete One",
            "/function delete Two",
        ]);
        expect(result.removed.map((t) => t.identity)).toEqual(["One", "Two"]);
        expect(result.failures).toEqual([]);
    });

    it("writes the record before removing anything", async () => {
        mocks.cached.set("FUNCTION:Leftover", {
            type: "FUNCTION",
            name: "Leftover",
            actions: [{ type: "MESSAGE", message: "bye" }],
        });

        await applyPrunePlan(commandRecordingCtx(), [target()], {
            manifestPath,
            housingUuid: HOUSE,
            parsed,
        });

        const record = recordFile();
        expect(record.removedCount).toBe(1);
        expect(record.recoveredContentCount).toBe(1);
        const removed = record.removed as { content: Importable | null }[];
        expect(removed[0].content).toEqual({
            type: "FUNCTION",
            name: "Leftover",
            actions: [{ type: "MESSAGE", message: "bye" }],
        });
    });

    it("records null content for something htsw never verified", async () => {
        await applyPrunePlan(commandRecordingCtx(), [target()], {
            manifestPath,
            housingUuid: HOUSE,
            parsed,
        });

        const record = recordFile();
        expect(record.recoveredContentCount).toBe(0);
        expect((record.removed as { content: unknown }[])[0].content).toBe(null);
    });

    it("reads live content for the record only when rescuing", async () => {
        mocks.liveReads.set("FUNCTION:Leftover", {
            type: "FUNCTION",
            name: "Leftover",
            actions: [],
        });

        await applyPrunePlan(commandRecordingCtx(), [target()], {
            manifestPath,
            housingUuid: HOUSE,
            parsed,
        });
        expect(mocks.readCalls).toEqual([]);

        await applyPrunePlan(commandRecordingCtx(), [target()], {
            manifestPath,
            housingUuid: HOUSE,
            parsed,
            rescue: true,
        });
        expect(mocks.readCalls).toEqual(["FUNCTION:Leftover"]);
        const records = Object.keys(files).filter(
            (name) => name.indexOf("/htsw/pruned/") >= 0
        );
        expect(records.length).toBe(2);
        expect(recordFile().recoveredContentCount).toBe(1);
    });

    it("keeps going after one removal fails and reports it", async () => {
        mocks.functionDeleteError = "on cooldown";

        const result = await applyPrunePlan(
            commandRecordingCtx(),
            [target({ identity: "One" }), target({ identity: "Two" })],
            { manifestPath, housingUuid: HOUSE, parsed }
        );

        expect(result.removed).toEqual([]);
        expect(result.failures.map((failure) => failure.target.identity)).toEqual([
            "One",
            "Two",
        ]);
        expect(result.failures[0].reason).toBe("on cooldown");
    });

    it("clears undeclared events by importing an empty action list", async () => {
        const result = await apply([
            target({ type: "EVENT", identity: "Player Quit", method: "clearActions" }),
        ]);

        expect(mocks.importSessions).toEqual([
            [{ type: "EVENT", event: "Player Quit", actions: [] }],
        ]);
        expect(result.removed.map((t) => t.identity)).toEqual(["Player Quit"]);
    });

    it("reports every event when the clearing import fails", async () => {
        mocks.importSessionError = "menu never opened";

        const result = await apply([
            target({ type: "EVENT", identity: "Player Quit", method: "clearActions" }),
            target({ type: "EVENT", identity: "Player Join", method: "clearActions" }),
        ]);

        expect(result.removed).toEqual([]);
        expect(result.failures.map((failure) => failure.reason)).toEqual([
            "menu never opened",
            "menu never opened",
        ]);
    });

    it("forgets deleted content from the cache but keeps a cleared event's entry", async () => {
        await applyPrunePlan(
            commandRecordingCtx(),
            [
                target({ identity: "Gone" }),
                target({
                    type: "EVENT",
                    identity: "Player Quit",
                    method: "clearActions",
                }),
            ],
            { manifestPath, housingUuid: HOUSE, parsed }
        );

        expect(mocks.cacheDeletes).toEqual(["FUNCTION:Gone"]);
    });

    it("drops every removed target from the lock, cleared events included", async () => {
        stubFiles([
            { type: "FUNCTION", identity: "Gone" },
            { type: "FUNCTION", identity: "Kept" },
            { type: "EVENT", identity: "Player Quit" },
        ]);

        await applyPrunePlan(
            commandRecordingCtx(),
            [
                target({ identity: "Gone" }),
                target({
                    type: "EVENT",
                    identity: "Player Quit",
                    method: "clearActions",
                }),
            ],
            { manifestPath, housingUuid: HOUSE, parsed }
        );

        const lock = readHouseLock(manifestPath);
        expect(Object.keys(lock?.importables ?? {})).toEqual(["FUNCTION:Kept"]);
    });

    it("leaves the lock alone when nothing was removed", async () => {
        mocks.functionDeleteError = "on cooldown";
        stubFiles([{ type: "FUNCTION", identity: "Gone" }]);
        const before = files[lockPath];

        await applyPrunePlan(commandRecordingCtx(), [target({ identity: "Gone" })], {
            manifestPath,
            housingUuid: HOUSE,
            parsed,
        });

        expect(files[lockPath]).toBe(before);
    });
});
