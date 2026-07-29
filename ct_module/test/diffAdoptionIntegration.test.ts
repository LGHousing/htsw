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
    otherSource: {
        type: "FUNCTION",
        name: "Other",
        actions: [{ type: "MESSAGE", message: "other source" }],
    } satisfies ImportableFunction,
    otherLive: {
        type: "FUNCTION",
        name: "Other",
        actions: [{ type: "MESSAGE", message: "other live" }],
    } satisfies ImportableFunction,
    files: new Map<string, string>(),
    fileWriteSucceeds: true,
    chats: [] as string[],
    task: undefined as Promise<unknown> | undefined,
    promptDecision: "confirm",
    promptOptions: [] as Array<{
        lines?: string[];
        onConfirm: () => void;
        onClose?: () => void;
    }>,
    scanActionList: vi.fn(),
    hydrateActionListScan: vi.fn(async () => undefined),
    progress: {
        start: vi.fn(),
        sinkFor: vi.fn(() => undefined),
        complete: vi.fn(),
        clear: vi.fn(),
        fail: vi.fn(),
    },
}));

vi.mock("htsw", async (importOriginal) => ({
    ...(await importOriginal<typeof import("htsw")>()),
    parseImportablesResult: () => ({
        value: [mocks.source, mocks.otherSource],
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

vi.mock("../src/gui/popovers/confirm", () => ({
    openConfirmPopover: (options: (typeof mocks.promptOptions)[number]) => {
        mocks.promptOptions.push(options);
        if (mocks.promptDecision === "confirm") options.onConfirm();
        else if (mocks.promptDecision === "decline") options.onClose?.();
        else if (mocks.promptDecision === "chat-confirm") {
            const instruction = mocks.chats.find((line) =>
                line.startsWith("[htsw] Type /htsw answer ")
            );
            const id = instruction?.match(/answer ([^ ]+) yes/)?.[1];
            if (id === undefined) throw new Error("missing prompt ID");
            answerConflictPrompt([id, "yes"]);
        }
    },
    closeConfirmPopover: () => undefined,
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
                names: readonly string[];
                output: {
                    accept: (importable: ImportableFunction) => void;
                };
            }
        ) => {
            for (const name of options.names) {
                options.output.accept(
                    name === mocks.live.name ? mocks.live : mocks.otherLive
                );
            }
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
            sleep: () => Promise<void>;
        }) => Promise<unknown>
    ) => {
        mocks.task = run({
            checkCancelled: () => undefined,
            displayMessage: () => undefined,
            sleep: async () => {
                if (mocks.promptDecision === "cancel") {
                    throw new Error("cancelled");
                }
            },
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
        mocks.files.set(path, content);
        return true;
    },
    getFileMtimeMs: (path: string) =>
        mocks.files.has(path) ? (mocks.files.get(path)?.length ?? 1) : 0,
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
import { buildTrustPlan, type TrustPlan } from "../src/importCache/trust";
import {
    readHouseLock,
    upsertHouseLockImportable,
} from "../src/importCache/houseLock";
import { readImportableCache } from "../src/importCache/cache";
import { commandDiff } from "../src/slashCommands/diff";
import { answerConflictPrompt } from "../src/gui/popovers/conflictPrompt";

const manifest = "import.json";
const lockPath = "./house.lock.json";
let testClock = 0;

function actionSession(trust: TrustPlan): ActionSyncContext {
    return {
        canonicalizeItemName: (name) => name,
        resolveItem: async () => null as never,
        trust,
        overwriteWarningMode: "always",
        conflicts: [],
        events: undefined,
        itemRead: { mode: "sync" },
    };
}

async function runDiff(args: string[] = []): Promise<void> {
    commandDiff([...args, manifest]);
    await mocks.task?.catch(() => undefined);
    await Promise.resolve();
}

beforeEach(() => {
    vi.useFakeTimers();
    testClock += 2000;
    vi.setSystemTime(new Date(1_800_000_000_000 + testClock));
    mocks.files.clear();
    mocks.files.set(manifest, "{}");
    mocks.fileWriteSucceeds = true;
    mocks.chats = [];
    mocks.task = undefined;
    mocks.promptDecision = "confirm";
    mocks.promptOptions = [];
    mocks.scanActionList.mockReset();
    mocks.hydrateActionListScan.mockClear();
    mocks.progress.start.mockClear();
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

describe("/htsw diff live-state adoption", () => {
    it("writes matching cache and lock entries only after one confirmation", async () => {
        await runDiff();

        expect(mocks.promptOptions).toHaveLength(1);
        const cache = readImportableCache("house", "FUNCTION", "Debug");
        const lock = readHouseLock(manifest);
        expect(cache?.importable).toEqual(mocks.live);
        expect(lock?.importables["FUNCTION:Debug"].hash).toBe(cache?.hash);
        expect(lock?.importables["FUNCTION:Debug"].itemDependencies).toEqual(
            cache?.itemDependencies
        );

        const trust = buildTrustPlan("house", [mocks.source], true, manifest);
        expect(trust.importables.get("FUNCTION:Debug")?.cacheMatchesLock).toBe(true);
        mocks.scanActionList.mockResolvedValue({
            slots: [
                observedSlot(0, {
                    type: "MESSAGE",
                    message: "shallow scan value",
                }),
            ],
        });
        const plan = await readActionListPlan(
            null as unknown as TaskContext,
            mocks.source.actions,
            {
                sync: actionSession(trust),
                baselineCurrent: mocks.live.actions,
                trustedBaselineAfterUnchangedScan: mocks.live.actions,
                conflictTarget: {
                    type: "FUNCTION",
                    identity: "Debug",
                    basePath: "actions",
                },
            }
        );

        expect(mocks.hydrateActionListScan).not.toHaveBeenCalled();
        expect(plan.observed[0].action).toEqual(mocks.live.actions[0]);
    });

    it("batches drifted and untracked lists into one grouped prompt", async () => {
        const baseline: ImportableFunction = {
            ...mocks.source,
            actions: [{ type: "MESSAGE", message: "baseline" }],
        };
        expect(
            upsertHouseLockImportable(manifest, "house", {
                importable: baseline,
                itemContent: undefined,
            })
        ).toBe(true);
        const lockBefore = mocks.files.get(lockPath);
        mocks.promptDecision = "decline";

        await runDiff();

        expect(mocks.promptOptions).toHaveLength(1);
        expect(mocks.promptOptions[0].lines).toEqual([
            "Someone changed these since your last import:",
            'FUNCTION "Debug" · actions',
            "These have never been tracked by HTSW:",
            'FUNCTION "Other" · actions',
        ]);
        expect(mocks.chats).toContain(
            "[htsw] Diff conflict: 2 live action lists differ from tracked state — awaiting confirmation\n" +
                '[htsw] Conflict: FUNCTION "Debug" · actions\n' +
                '[htsw] Conflict: FUNCTION "Other" · actions'
        );
        expect(mocks.chats).toContainEqual(
            expect.stringMatching(
                /^\[htsw] Type \/htsw answer \S+ yes to adopt live state or \/htsw answer \S+ no to leave it unchanged\.$/
            )
        );
        expect(mocks.files.has(lockPath)).toBe(true);
        expect(mocks.files.get(lockPath)).toBe(lockBefore);
        expect(readHouseLock(manifest)?.importables["FUNCTION:Debug"].hash).not.toBe(
            readImportableCache("house", "FUNCTION", "Debug")?.hash
        );
        expect(readImportableCache("house", "FUNCTION", "Other")).toBeNull();
    });

    it("leaves cache and lock untouched when the prompt is declined", async () => {
        mocks.promptDecision = "decline";
        const before = new Map(mocks.files);

        await runDiff();

        expect(mocks.promptOptions).toHaveLength(1);
        expect(mocks.files).toEqual(before);
    });

    it("accepts the adoption prompt from typed chat", async () => {
        mocks.promptDecision = "chat-confirm";

        await runDiff();

        expect(mocks.promptOptions).toHaveLength(1);
        expect(readHouseLock(manifest)?.importables["FUNCTION:Debug"]).toBeDefined();
        expect(readImportableCache("house", "FUNCTION", "Debug")).not.toBeNull();
    });

    it("does not write the cache or lock when the task is cancelled at the prompt", async () => {
        mocks.promptDecision = "cancel";

        await runDiff();

        expect(mocks.promptOptions).toHaveLength(1);
        expect(readHouseLock(manifest)).toBeNull();
        expect(readImportableCache("house", "FUNCTION", "Debug")).toBeNull();
    });
});
