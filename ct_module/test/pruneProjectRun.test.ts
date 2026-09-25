import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Importable } from "htsw/types";

type FakeParsed = {
    value: Importable[];
    diagnostics: { level: string }[];
    importJson: { dangerouslyDeleteEverythingNotInThisFile: boolean; houseUuid: string | null };
};

type FakeTarget = {
    type: string;
    identity: string;
    label: string;
    method: string;
    owned: boolean;
};

type FakePlan = { targets: FakeTarget[]; scanFailures: { type: string; reason: string }[] };

function emptyPlan(): FakePlan {
    return { targets: [], scanFailures: [] };
}

function fakeTarget(identity: string, owned: boolean): FakeTarget {
    return { type: "FUNCTION", identity, label: identity, method: "delete", owned };
}

const mocks = vi.hoisted(() => ({
    parsed: null as FakeParsed | null,
    tracked: new Set<string>(),
    boundHouses: new Map<string, string>(),
    lockPlan: emptyPlan(),
    scanPlan: emptyPlan(),
    scans: 0,
    renames: [] as { type: string; from: string; to: string }[],
    renamed: [] as string[],
    applied: [] as string[],
    rescue: [] as boolean[],
    applyFails: [] as string[],
    consented: true,
    confirmAnswer: true,
    confirmCalls: 0,
}));

vi.mock("../src/gui/parsing/parses", () => ({
    canonicalPath: (path: string) => path,
    parseImportJsonCurrent: async (path: string) => ({
        canonicalPath: path,
        parsed: mocks.parsed,
    }),
}));
vi.mock("../src/gui/state/autoTrack", () => ({
    getAutoTrackSources: () => mocks.tracked,
}));
vi.mock("../src/gui/autoTrackScope", () => ({
    autoTrackBoundHouse: (path: string) => mocks.boundHouses.get(path) ?? null,
}));
vi.mock("../src/prune/apply", () => ({
    applyPrunePlan: async (
        _ctx: unknown,
        targets: { identity: string }[],
        request: { rescue?: boolean }
    ) => {
        mocks.rescue.push(request.rescue === true);
        const removed: { identity: string }[] = [];
        const failures: { target: { identity: string }; reason: string }[] = [];
        for (const target of targets) {
            if (mocks.applyFails.includes(target.identity)) {
                failures.push({ target, reason: "refused" });
                continue;
            }
            mocks.applied.push(target.identity);
            removed.push(target);
        }
        return { removed, failures, recordPath: null, recordError: null };
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
vi.mock("../src/prune/rename", () => ({
    applyRenames: async (
        _ctx: unknown,
        _path: string,
        renames: { from: string; to: string }[]
    ) => {
        for (const rename of renames) mocks.renamed.push(`${rename.from}->${rename.to}`);
        return { renamed: renames, unconfirmed: [] };
    },
}));
vi.mock("../src/prune/plan", () => ({
    vanishedWork: () => ({ plan: mocks.lockPlan, renames: mocks.renames }),
    scanHousePrunePlan: async () => {
        mocks.scans++;
        return mocks.scanPlan;
    },
}));
vi.mock("../src/prune/report", () => ({ formatPrunePlan: () => [] }));

import {
    beginProjectRun,
    finishProjectRun,
    hasPendingRemovals,
    needsArmingScan,
    resetArmingScans,
} from "../src/prune/projectRun";
import { makeBulkQueueRow } from "../src/gui/right-panel/import-tab/queue";
import type TaskContext from "../src/tasks/context";

const manifest = "./projects/demo/import.json";
const house = "house-1";
const ctx = { checkCancelled: () => undefined } as unknown as TaskContext;
const row = makeBulkQueueRow({
    op: "import",
    house,
    path: manifest,
    scope: { kind: "file", path: manifest },
    filter: "modified",
    label: "demo",
});

const autoTrackedRow = { ...row, origin: "autotrack" as const };

function armed(overrides: Partial<FakeParsed> = {}): FakeParsed {
    return {
        value: [],
        diagnostics: [],
        importJson: { dangerouslyDeleteEverythingNotInThisFile: true, houseUuid: house },
        ...overrides,
    };
}

beforeEach(() => {
    mocks.parsed = armed();
    mocks.tracked = new Set([manifest]);
    mocks.boundHouses = new Map([[manifest, house]]);
    mocks.lockPlan = emptyPlan();
    mocks.scanPlan = emptyPlan();
    mocks.scans = 0;
    mocks.renames = [];
    mocks.renamed = [];
    mocks.applied = [];
    mocks.rescue = [];
    mocks.applyFails = [];
    mocks.consented = true;
    mocks.confirmAnswer = true;
    mocks.confirmCalls = 0;
    resetArmingScans();
    vi.stubGlobal("ChatLib", { chat: () => undefined });
});

describe("finishing a project run", () => {
    it("leaves the house alone for a project without the key", async () => {
        mocks.parsed = armed({
            importJson: { dangerouslyDeleteEverythingNotInThisFile: false, houseUuid: house },
        });
        mocks.scanPlan = { targets: [fakeTarget("Stray", false)], scanFailures: [] };

        await finishProjectRun(ctx, row, house);

        expect(mocks.scans).toBe(0);
        expect(mocks.applied).toEqual([]);
    });

    it("scans the whole house when you started the run", async () => {
        mocks.scanPlan = { targets: [fakeTarget("Stray", false)], scanFailures: [] };

        await finishProjectRun(ctx, row, house);

        expect(mocks.scans).toBe(1);
        expect(mocks.applied).toEqual(["Stray"]);
        expect(mocks.rescue).toEqual([true]);
    });

    it("scans an auto-tracked project once per auto-run session", async () => {
        mocks.scanPlan = { targets: [fakeTarget("Stray", false)], scanFailures: [] };
        await finishProjectRun(ctx, autoTrackedRow, house);
        expect(mocks.scans).toBe(1);
        expect(mocks.applied).toEqual(["Stray"]);

        // Later saves only remove what they stopped declaring.
        mocks.lockPlan = { targets: [fakeTarget("Gone", true)], scanFailures: [] };
        await finishProjectRun(ctx, autoTrackedRow, house);
        expect(mocks.scans).toBe(1);
        expect(mocks.applied).toEqual(["Stray", "Gone"]);

        resetArmingScans();
        await finishProjectRun(ctx, autoTrackedRow, house);
        expect(mocks.scans).toBe(2);
    });

    it("scans again after an auto-tracked scan came back incomplete", async () => {
        mocks.scanPlan = { targets: [], scanFailures: [{ type: "MENU", reason: "timed out" }] };
        await expect(finishProjectRun(ctx, autoTrackedRow, house)).rejects.toThrow();
        expect(needsArmingScan(manifest)).toBe(true);
    });

    it("refuses a project that has errors", async () => {
        mocks.parsed = armed({ diagnostics: [{ level: "error" }] });
        mocks.scanPlan = { targets: [fakeTarget("Stray", false)], scanFailures: [] };

        await expect(finishProjectRun(ctx, row, house)).rejects.toThrow(
            /has 1 error/
        );
        expect(mocks.applied).toEqual([]);
    });

    it("refuses while another tracked project is bound to the same house", async () => {
        const other = "./projects/other/import.json";
        mocks.tracked = new Set([manifest, other]);
        mocks.boundHouses.set(other, house);
        mocks.scanPlan = { targets: [fakeTarget("Stray", false)], scanFailures: [] };

        await expect(finishProjectRun(ctx, row, house)).rejects.toThrow(
            /also tracked for this house/
        );
        expect(mocks.applied).toEqual([]);
    });

    it("asks the first time and removes nothing when declined", async () => {
        mocks.consented = false;
        mocks.confirmAnswer = false;
        mocks.scanPlan = { targets: [fakeTarget("Stray", false)], scanFailures: [] };

        await expect(finishProjectRun(ctx, row, house)).rejects.toThrow(/declined/);
        expect(mocks.confirmCalls).toBe(1);
        expect(mocks.applied).toEqual([]);
    });

    it("does not ask again once the project has been confirmed", async () => {
        mocks.scanPlan = { targets: [fakeTarget("Stray", false)], scanFailures: [] };

        await finishProjectRun(ctx, row, house);

        expect(mocks.confirmCalls).toBe(0);
        expect(mocks.applied).toEqual(["Stray"]);
    });

    it("fails when Housing refuses a removal", async () => {
        mocks.applyFails = ["Stuck"];
        mocks.scanPlan = {
            targets: [fakeTarget("Stuck", true), fakeTarget("Stray", false)],
            scanFailures: [],
        };

        await expect(finishProjectRun(ctx, row, house)).rejects.toThrow(
            /1 undeclared thing couldn't be removed/
        );
        expect(mocks.applied).toEqual(["Stray"]);
    });

    it("removes what did scan but fails when part of the scan did not", async () => {
        mocks.scanPlan = {
            targets: [fakeTarget("Stray", false)],
            scanFailures: [{ type: "MENU", reason: "timed out" }],
        };

        await expect(finishProjectRun(ctx, row, house)).rejects.toThrow(
            /couldn't scan menu/
        );
        expect(mocks.applied).toEqual(["Stray"]);
    });
});

describe("beginning a project run", () => {
    it("renames what a save renamed", async () => {
        mocks.renames = [{ type: "FUNCTION", from: "Old", to: "New" }];

        await beginProjectRun(ctx, row, house);

        expect(mocks.renamed).toEqual(["Old->New"]);
    });

    it("renames nothing for a project that may not prune", async () => {
        mocks.parsed = armed({ diagnostics: [{ level: "error" }] });
        mocks.renames = [{ type: "FUNCTION", from: "Old", to: "New" }];

        await beginProjectRun(ctx, row, house);

        expect(mocks.renamed).toEqual([]);
    });
});

describe("pending removals", () => {
    it("reads house.lock once per parse until a run changes it", async () => {
        const parsed = armed();
        mocks.lockPlan = { targets: [fakeTarget("Gone", true)], scanFailures: [] };
        expect(hasPendingRemovals(manifest, parsed as never)).toBe(true);

        mocks.lockPlan = emptyPlan();
        expect(hasPendingRemovals(manifest, parsed as never)).toBe(true);

        mocks.parsed = parsed;
        mocks.scanPlan = emptyPlan();
        await finishProjectRun(ctx, autoTrackedRow, house);
        mocks.lockPlan = { targets: [fakeTarget("Gone", true)], scanFailures: [] };
        await finishProjectRun(ctx, autoTrackedRow, house);
        mocks.lockPlan = emptyPlan();
        expect(hasPendingRemovals(manifest, parsed as never)).toBe(false);
    });
});
