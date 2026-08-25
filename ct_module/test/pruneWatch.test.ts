import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Importable } from "htsw/types";

type FakeParse = {
    canonicalPath: string;
    parsed: {
        value: Importable[];
        diagnostics: { level: string }[];
        importJson: { dangerouslyDeleteEverythingNotInThisFile: boolean };
    } | null;
};

type FakePlan = {
    targets: {
        type: string;
        identity: string;
        label: string;
        method: string;
        owned: boolean;
    }[];
    unsupported: unknown[];
    scanFailures: unknown[];
};

function emptyFakePlan(): FakePlan {
    return { targets: [], unsupported: [], scanFailures: [] };
}

const mocks = vi.hoisted(() => ({
    parses: [] as FakeParse[],
    currentHouse: "house-1",
    boundHouses: new Map<string, string>(),
    taskBusy: false,
    tasksRun: 0,
    applied: [] as string[],
    consented: true,
    confirmAnswer: true,
    confirmCalls: 0,
    toasts: [] as string[],
    chats: [] as string[],
    lock: [] as { type: string; identity: string }[],
    sweepPlan: emptyFakePlan(),
}));

vi.mock("../src/gui/parsing/parses", () => ({
    forEachCachedParse: (cb: (entry: FakeParse) => void) => mocks.parses.forEach(cb),
}));
vi.mock("../src/gui/state/housing", () => ({
    getHousingUuid: () => mocks.currentHouse,
}));
vi.mock("../src/gui/autoTrackScope", () => ({
    autoTrackBoundHouse: (path: string) => mocks.boundHouses.get(path) ?? null,
}));
vi.mock("../src/gui/toast", () => ({
    showToast: (message: string) => mocks.toasts.push(message),
}));
vi.mock("../src/importCache/housingId", () => ({
    getCurrentHousingUuid: async () => mocks.currentHouse,
}));
vi.mock("../src/tasks/manager", () => ({
    TaskManager: { isBusy: () => mocks.taskBusy },
    isTaskCancelled: () => false,
}));
vi.mock("../src/housingSync/taskRunner", () => ({
    runHousingSyncTask: async (_kind: string, task: (ctx: unknown) => Promise<void>) => {
        mocks.tasksRun++;
        await task({ checkCancelled: () => undefined });
    },
}));
vi.mock("../src/prune/apply", () => ({
    applyPrunePlan: async (
        _ctx: unknown,
        targets: { identity: string }[]
    ) => {
        for (const target of targets) mocks.applied.push(target.identity);
        return { removed: targets, failures: [], recordPath: null, recordError: null };
    },
    formatPruneApplyResult: () => [],
}));
vi.mock("../src/prune/consent", () => ({
    hasPruneConsent: () => mocks.consented,
    grantPruneConsent: () => true,
}));
vi.mock("../src/prune/session", () => ({
    confirmPrune: async () => {
        mocks.confirmCalls++;
        return mocks.confirmAnswer;
    },
}));
vi.mock("../src/prune/plan", () => ({
    vanishedPrunePlan: (declared: Importable[]) => {
        const names = new Set(
            declared.map((importable) =>
                importable.type === "FUNCTION" ? importable.name : ""
            )
        );
        return {
            targets: mocks.lock
                .filter((entry) => !names.has(entry.identity))
                .map((entry) => ({
                    type: entry.type,
                    identity: entry.identity,
                    label: entry.identity,
                    method: "delete",
                    owned: true,
                })),
            unsupported: [],
            scanFailures: [],
        };
    },
    scanHousePrunePlan: async () => mocks.sweepPlan,
}));

import {
    clearPruneNotice,
    getPruneNotice,
    watchPruneOnReparse,
    watchPruneSweep,
} from "../src/prune/watch";

const manifest = "./projects/demo/import.json";

function armedParse(overrides: Partial<FakeParse["parsed"]> = {}): FakeParse {
    return {
        canonicalPath: manifest,
        parsed: {
            value: [],
            diagnostics: [],
            importJson: { dangerouslyDeleteEverythingNotInThisFile: true },
            ...overrides,
        },
    };
}

const tracked = new Set([manifest]);

beforeEach(() => {
    mocks.parses = [armedParse()];
    mocks.currentHouse = "house-1";
    mocks.boundHouses = new Map([[manifest, "house-1"]]);
    mocks.taskBusy = false;
    mocks.tasksRun = 0;
    mocks.applied = [];
    mocks.consented = true;
    mocks.confirmAnswer = true;
    mocks.confirmCalls = 0;
    mocks.toasts = [];
    mocks.chats = [];
    mocks.lock = [{ type: "FUNCTION", identity: "Removed" }];
    mocks.sweepPlan = emptyFakePlan();
    vi.stubGlobal("ChatLib", { chat: (line: string) => mocks.chats.push(line) });
});

describe("watchPruneOnReparse", () => {
    it("removes what the save stopped declaring", async () => {
        watchPruneOnReparse(tracked);
        await vi.waitFor(() => expect(mocks.applied).toEqual(["Removed"]));
    });

    it("does nothing for a project that is not armed", async () => {
        mocks.parses = [
            armedParse({ importJson: { dangerouslyDeleteEverythingNotInThisFile: false } }),
        ];

        watchPruneOnReparse(tracked);

        expect(mocks.tasksRun).toBe(0);
    });

    it("does nothing for a project that is not tracked", () => {
        watchPruneOnReparse(new Set<string>());

        expect(mocks.tasksRun).toBe(0);
    });

    // a half-parsed manifest declares less than the project has
    it("refuses to act on a manifest with errors", () => {
        mocks.parses = [armedParse({ diagnostics: [{ level: "error" }] })];

        watchPruneOnReparse(tracked);

        expect(mocks.tasksRun).toBe(0);
    });

    it("does nothing when standing in a different house than the project claims", () => {
        mocks.boundHouses = new Map([[manifest, "house-2"]]);

        watchPruneOnReparse(tracked);

        expect(mocks.tasksRun).toBe(0);
    });

    it("stays out of the way while another task is running", () => {
        mocks.taskBusy = true;

        watchPruneOnReparse(tracked);

        expect(mocks.tasksRun).toBe(0);
    });

    it("asks before the first removal for a project and remembers the answer", async () => {
        mocks.consented = false;

        watchPruneOnReparse(tracked);

        await vi.waitFor(() => expect(mocks.confirmCalls).toBe(1));
        expect(mocks.applied).toEqual(["Removed"]);
    });

    it("removes nothing when that first confirmation is declined", async () => {
        mocks.consented = false;
        mocks.confirmAnswer = false;

        watchPruneOnReparse(tracked);

        await vi.waitFor(() => expect(mocks.confirmCalls).toBe(1));
        expect(mocks.applied).toEqual([]);
    });
});

describe("watchPruneSweep", () => {
    it("removes owned content but only raises a notice for the rest", async () => {
        mocks.sweepPlan = {
            targets: [
                {
                    type: "FUNCTION",
                    identity: "Mine",
                    label: "Mine",
                    method: "delete",
                    owned: true,
                },
                {
                    type: "FUNCTION",
                    identity: "Theirs",
                    label: "Theirs",
                    method: "delete",
                    owned: false,
                },
            ],
            unsupported: [],
            scanFailures: [],
        };

        watchPruneSweep(tracked);

        await vi.waitFor(() => expect(mocks.applied).toEqual(["Mine"]));
        expect(getPruneNotice()).toEqual({
            manifestPath: manifest,
            unownedCount: 1,
        });
        clearPruneNotice();
    });

    it("raises no notice when everything undeclared was made by htsw", async () => {
        mocks.sweepPlan = {
            targets: [
                {
                    type: "FUNCTION",
                    identity: "Mine",
                    label: "Mine",
                    method: "delete",
                    owned: true,
                },
            ],
            unsupported: [],
            scanFailures: [],
        };

        watchPruneSweep(tracked);

        await vi.waitFor(() => expect(mocks.applied).toEqual(["Mine"]));
        expect(getPruneNotice()).toBe(null);
    });
});
