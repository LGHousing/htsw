import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportableFunction } from "htsw/types";

import type { ActionSyncContext } from "../src/housingSync/actions/syncContext";
import type TaskContext from "../src/tasks/context";
import { observedSlot } from "./utils";

const mocks = vi.hoisted(() => ({
    source: {
        type: "FUNCTION",
        name: "Debug",
        actions: [{ type: "MESSAGE", message: "source" }],
    } satisfies ImportableFunction,
    live: {
        type: "FUNCTION",
        name: "Debug",
        actions: [{ type: "MESSAGE", message: "live at diff" }],
    } satisfies ImportableFunction,
    files: new Map<string, string>(),
    atomicWriteSucceeds: true,
    fileWriteSucceeds: true,
    chats: [] as string[],
    task: undefined as Promise<unknown> | undefined,
    scanActionList: vi.fn(),
    hydrateActionListScan: vi.fn(async () => undefined),
    progress: {
        sinkFor: vi.fn(() => undefined),
        complete: vi.fn(),
        clear: vi.fn(),
        fail: vi.fn(),
    },
}));

vi.mock("htsw", async (importOriginal) => ({
    ...(await importOriginal<typeof import("htsw")>()),
    parseImportablesResult: () => ({
        value: [mocks.source],
        diagnostics: [],
    }),
}));

vi.mock("../src/gui/parsing/parses", () => ({
    canonicalPath: (path: string) => path,
}));

vi.mock("../src/project/paths", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/project/paths")>()),
    resolveModuleRelativePath: (path: string) => path,
}));

vi.mock("../src/importCache/housingId", () => ({
    getCurrentHousingUuid: async () => "house",
}));

vi.mock("../src/importables/export/projectDestination", () => ({
    projectItemsFromParsedImportJson: () => [],
}));

vi.mock("../src/importables/export/readers", () => ({
    HOUSE_READERS: {
        FUNCTION: async (
            _ctx: unknown,
            options: {
                output: { accept: (importable: ImportableFunction) => void };
            }
        ) => {
            options.output.accept(mocks.live);
        },
    },
}));

vi.mock("../src/tasks/manager", () => ({
    TaskManager: { isBusy: () => false },
    isTaskCancelled: () => false,
}));

vi.mock("../src/housingSync/taskRunner", () => ({
    runHousingSyncTask: (
        _kind: string,
        run: (ctx: {
            checkCancelled: () => undefined;
            displayMessage: () => undefined;
        }) => Promise<unknown>
    ) => {
        mocks.task = run({
            checkCancelled: () => undefined,
            displayMessage: () => undefined,
        });
        return mocks.task;
    },
}));

vi.mock("../src/gui/right-panel/import-tab/diffProgress", () => ({
    createDiffProgressSession: () => mocks.progress,
}));

vi.mock("../src/slashCommands/diffDetails", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/slashCommands/diffDetails")>()),
    writeDiffDetailsFile: () => "./htsw-diff/latest.diff",
}));

vi.mock("../src/utils/filesystem", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/utils/filesystem")>()),
    atomicWriteText: (path: string, content: string) => {
        if (!mocks.atomicWriteSucceeds) return false;
        mocks.files.set(path, content);
        return true;
    },
}));

vi.mock("../src/housingSync/actions/readList", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/housingSync/actions/readList")>()),
    scanActionList: mocks.scanActionList,
}));

vi.mock("../src/housingSync/actions/hydration/run", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("../src/housingSync/actions/hydration/run")
    >()),
    hydrateActionListScan: mocks.hydrateActionListScan,
}));

import { readActionListPlan } from "../src/housingSync/actions/plan";
import {
    ACTION_LIST_CONTENT_HASH_VERSION,
    ACTION_LIST_SCAN_HASH_VERSION,
} from "../src/housingSync/actions/scanHash";
import { buildTrustPlan, type TrustPlan } from "../src/importCache/trust";
import { commandDiff } from "../src/slashCommands/diff";
import { parseImportCommandArgs } from "../src/slashCommands/importArgs";

const manifest = "import.json";
const lockPath = "./house.lock.json";

function actionSession(trust: TrustPlan, freshHydration = false): ActionSyncContext {
    return {
        canonicalizeItemName: (name) => name,
        resolveItem: async () => null as never,
        trust,
        overwriteWarningMode: "always",
        conflicts: [],
        events: undefined,
        itemRead: { mode: "sync" },
        freshHydration,
    };
}

async function runDiff(): Promise<void> {
    commandDiff([manifest]);
    await mocks.task?.catch(() => undefined);
    await Promise.resolve();
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00.000Z"));
    mocks.files.clear();
    mocks.files.set(manifest, "{}");
    mocks.atomicWriteSucceeds = true;
    mocks.fileWriteSucceeds = true;
    mocks.chats = [];
    mocks.task = undefined;
    mocks.scanActionList.mockReset();
    mocks.hydrateActionListScan.mockClear();
    mocks.progress.complete.mockClear();
    mocks.progress.clear.mockClear();
    mocks.progress.fail.mockClear();
    vi.stubGlobal("ChatLib", {
        chat: (line: string) => mocks.chats.push(line),
    });
    vi.stubGlobal("FileLib", {
        exists: (path: string) => mocks.files.has(path),
        read: (path: string) => mocks.files.get(path) ?? null,
        write: (path: string, content: string) => {
            if (!mocks.fileWriteSucceeds) throw new Error("write failed");
            mocks.files.set(path, content);
        },
    });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("staged diff import wiring", () => {
    it("writes through diff, loads through trust, reuses once scanned, and honors --fresh", async () => {
        await runDiff();

        expect(mocks.chats.some((line) => line.includes("Diff complete"))).toBe(true);
        const trust = buildTrustPlan("house", [mocks.source], false, manifest);
        expect(
            trust.importables.get("FUNCTION:Debug")?.stagedActionLists?.get("actions")
                ?.actions
        ).toEqual(mocks.live.actions);

        const changedAfterDiff = {
            type: "MESSAGE",
            message: "changed after diff",
        } as const;
        mocks.scanActionList.mockResolvedValue({
            slots: [observedSlot(0, changedAfterDiff)],
        });
        const reused = await readActionListPlan(
            null as unknown as TaskContext,
            mocks.source.actions,
            {
                sync: actionSession(trust),
                conflictTarget: {
                    type: "FUNCTION",
                    identity: "Debug",
                    basePath: "actions",
                },
            }
        );

        expect(mocks.hydrateActionListScan).not.toHaveBeenCalled();
        expect(reused.observed[0].action).toEqual(mocks.live.actions[0]);

        const parsedArgs = parseImportCommandArgs(["--fresh", manifest]);
        const fresh = await readActionListPlan(
            null as unknown as TaskContext,
            mocks.source.actions,
            {
                sync: actionSession(trust, parsedArgs.fresh),
                conflictTarget: {
                    type: "FUNCTION",
                    identity: "Debug",
                    basePath: "actions",
                },
            }
        );

        expect(mocks.hydrateActionListScan).toHaveBeenCalledOnce();
        expect(fresh.observed[0].action).toEqual(changedAfterDiff);

        mocks.hydrateActionListScan.mockClear();
        vi.setSystemTime(new Date("2026-07-28T12:10:00.001Z"));
        await readActionListPlan(null as unknown as TaskContext, mocks.source.actions, {
            sync: actionSession(trust),
            conflictTarget: {
                type: "FUNCTION",
                identity: "Debug",
                basePath: "actions",
            },
        });

        expect(mocks.hydrateActionListScan).toHaveBeenCalledOnce();
    });

    it("reports a staged hydration write failure instead of completing", async () => {
        mocks.atomicWriteSucceeds = false;

        await runDiff();

        expect(mocks.chats).toContain(
            '[htsw] Diff failed: could not stage FUNCTION "Debug" · actions'
        );
        expect(mocks.chats.some((line) => line.includes("Diff complete"))).toBe(false);
        expect(mocks.files.has(lockPath)).toBe(false);
    });

    it("reports an incompatible lock instead of rewriting or completing", async () => {
        const rawLock = JSON.stringify({
            schemaVersion: 1,
            houseUuid: "house",
            scanHashVersion: ACTION_LIST_SCAN_HASH_VERSION + 1,
            contentHashVersion: ACTION_LIST_CONTENT_HASH_VERSION + 1,
            importables: {
                "FUNCTION:Debug": {
                    type: "FUNCTION",
                    identity: "Debug",
                    hash: "future",
                    listScanHashes: { actions: "future-scan" },
                    listContentHashes: { actions: "future-content" },
                },
            },
        });
        mocks.files.set(lockPath, rawLock);

        await runDiff();

        expect(mocks.chats).toContain(
            "[htsw] Diff failed: could not update house.lock.json"
        );
        expect(mocks.chats.some((line) => line.includes("Diff complete"))).toBe(false);
        expect(mocks.files.get(lockPath)).toBe(rawLock);
    });

    it("reports a lock write failure instead of completing", async () => {
        mocks.fileWriteSucceeds = false;

        await runDiff();

        expect(mocks.chats).toContain(
            "[htsw] Diff failed: could not update house.lock.json"
        );
        expect(mocks.chats.some((line) => line.includes("Diff complete"))).toBe(false);
        expect(mocks.files.has(lockPath)).toBe(false);
    });

    it("reports a lock for another house without rewriting or completing", async () => {
        const rawLock = JSON.stringify({
            schemaVersion: 1,
            houseUuid: "another-house",
            scanHashVersion: ACTION_LIST_SCAN_HASH_VERSION,
            contentHashVersion: ACTION_LIST_CONTENT_HASH_VERSION,
            importables: {},
        });
        mocks.files.set(lockPath, rawLock);

        await runDiff();

        expect(mocks.chats).toContain(
            "[htsw] Diff failed: could not update house.lock.json"
        );
        expect(mocks.chats.some((line) => line.includes("Diff complete"))).toBe(false);
        expect(mocks.files.get(lockPath)).toBe(rawLock);
    });
});
