import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, ImportableFunction } from "htsw/types";

import { importableHash } from "../src/importCache/hash";
import type { ResultImport } from "../src/gui/left-panel/projects/rowModel";

const state = {
    housingUuid: null as string | null,
    statusKey: "ctx-1",
    statuses: new Map<string, "current" | "modified" | "unknown" | null>(),
    mtimes: new Map<string, number>(),
    treeBumps: 0,
    dirtyMarks: 0,
    busy: false,
};

vi.mock("../src/gui/state", () => ({
    getHousingUuid: () => state.housingUuid,
}));
vi.mock("../src/gui/cache-status", () => ({
    cachedStatusForImportable: (imp: ImportableFunction) =>
        state.statuses.get(imp.name) ?? null,
    importableLinkStatusContextKey: () => state.statusKey,
}));
vi.mock("../src/tasks/manager", () => ({
    TaskManager: { isBusy: () => state.busy },
}));
vi.mock("../src/gui/lib/dirty", () => ({
    markGuiDirty: () => {
        state.dirtyMarks++;
    },
}));
vi.mock("../src/gui/lib/java", () => ({
    getMtimeMs: (path: string) => state.mtimes.get(path) ?? 0,
}));
vi.mock("../src/gui/parsing/parses", () => ({
    canonicalPath: (path: string) => path,
}));
vi.mock("../src/gui/left-panel/projects/acceptHouseLock", () => ({
    confirmAcceptProjectLock: () => undefined,
}));
vi.mock("../src/gui/left-panel/projects/rowModel", () => ({
    ROW_BG: 0,
    ROW_HOVER_BG: 0,
    bumpTreeRevision: () => {
        state.treeBumps++;
    },
}));

function fn(name: string, message: string): ImportableFunction {
    const actions: Action[] = [{ type: "MESSAGE", message }];
    return { type: "FUNCTION", name, actions };
}

const UUID = "lock-banner-house";
const IMPORT_JSON = "./projects/demo/import.json";
const LOCK_PATH = "./projects/demo/house.lock.json";

function project(importables: ImportableFunction[], houseUuid: string | null = UUID): ResultImport {
    return {
        type: "import",
        path: "demo/import.json",
        fullPath: IMPORT_JSON,
        importables,
        parsePending: false,
        parse: {
            value: importables,
            importJson: { houseUuid },
        } as unknown as ResultImport["parse"],
    };
}

function writeLock(files: Map<string, string>, entries: ImportableFunction[]): void {
    const importables: Record<string, unknown> = {};
    for (const entry of entries) {
        importables[`FUNCTION:${entry.name}`] = {
            type: "FUNCTION",
            identity: entry.name,
            hash: importableHash(entry),
        };
    }
    files.set(LOCK_PATH, JSON.stringify({ schemaVersion: 1, houseUuid: UUID, importables }));
}

describe("lockBannerFor", () => {
    let files: Map<string, string>;

    beforeEach(() => {
        vi.resetModules();
        files = new Map();
        state.housingUuid = UUID;
        state.statusKey = "ctx-1";
        state.statuses = new Map();
        state.mtimes = new Map([[LOCK_PATH, 1000]]);
        state.treeBumps = 0;
        state.dirtyMarks = 0;
        state.busy = false;
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files.has(path),
            read: (path: string) => files.get(path) ?? null,
        });
    });

    it("counts lock-certified entries the cache still shows as changed", async () => {
        const synced = fn("Synced", "same");
        const behind = fn("Behind", "same");
        const fresh = fn("Fresh", "same");
        const edited = fn("Edited", "working tree");
        writeLock(files, [synced, behind, fresh, fn("Edited", "locked")]);
        state.statuses.set("Synced", "current");
        state.statuses.set("Behind", "modified");
        state.statuses.set("Fresh", "unknown");
        state.statuses.set("Edited", "modified");
        const { lockBannerFor } = await import("../src/gui/left-panel/projects/lockBanner");

        expect(lockBannerFor(project([synced, behind, fresh, edited]))).toEqual({
            count: 2,
            lockMtime: 1000,
        });
    });

    it("stays hidden unless the project is bound to the house you're in", async () => {
        const behind = fn("Behind", "same");
        writeLock(files, [behind]);
        state.statuses.set("Behind", "modified");
        const { lockBannerFor } = await import("../src/gui/left-panel/projects/lockBanner");

        expect(lockBannerFor(project([behind], null))).toBeNull();
        expect(lockBannerFor(project([behind], "other-house"))).toBeNull();
        state.housingUuid = "other-house";
        expect(lockBannerFor(project([behind], "other-house"))).toBeNull();
        state.housingUuid = null;
        expect(lockBannerFor(project([behind]))).toBeNull();
    });

    it("stays hidden without a lock file or with everything current", async () => {
        const behind = fn("Behind", "same");
        state.statuses.set("Behind", "modified");
        const { lockBannerFor } = await import("../src/gui/left-panel/projects/lockBanner");
        state.mtimes.delete(LOCK_PATH);
        expect(lockBannerFor(project([behind]))).toBeNull();

        vi.resetModules();
        const reloaded = await import("../src/gui/left-panel/projects/lockBanner");
        state.mtimes.set(LOCK_PATH, 1000);
        writeLock(files, [behind]);
        state.statuses.set("Behind", "current");
        expect(reloaded.lockBannerFor(project([behind]))).toBeNull();
    });

    it("memoizes on the status context and re-evaluates when it changes", async () => {
        const behind = fn("Behind", "same");
        writeLock(files, [behind]);
        state.statuses.set("Behind", "modified");
        const { lockBannerFor } = await import("../src/gui/left-panel/projects/lockBanner");
        const r = project([behind]);

        expect(lockBannerFor(r)?.count).toBe(1);
        state.statuses.set("Behind", "current");
        expect(lockBannerFor(r)?.count).toBe(1);
        state.statusKey = "ctx-2";
        expect(lockBannerFor(r)).toBeNull();
    });

    it("notices a rewritten lock from the render-tick poll and dirties the GUI", async () => {
        const behind = fn("Behind", "same");
        state.statuses.set("Behind", "modified");
        const banner = await import("../src/gui/left-panel/projects/lockBanner");
        const r = project([behind]);
        writeLock(files, []);
        expect(banner.lockBannerFor(r)).toBeNull();

        vi.useFakeTimers();
        try {
            const before = banner.getLockBannerRevision();
            writeLock(files, [behind]);
            state.mtimes.set(LOCK_PATH, 2000);
            banner.pollLockBanners();
            expect(banner.getLockBannerRevision()).toBe(before);
            expect(state.dirtyMarks).toBe(0);
            vi.advanceTimersByTime(1500);
            // The idle overlay never rebuilds the tree on its own; the poll
            // has to mark the GUI dirty so the next frame picks the lock up.
            banner.pollLockBanners();
            expect(state.dirtyMarks).toBe(1);
            expect(banner.getLockBannerRevision()).toBe(before + 1);
            expect(banner.lockBannerFor(r)).toEqual({ count: 1, lockMtime: 2000 });
            vi.advanceTimersByTime(1500);
            banner.pollLockBanners();
            expect(state.dirtyMarks).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("hides while a task runs and re-evaluates once on the idle edge", async () => {
        const behind = fn("Behind", "same");
        writeLock(files, [behind]);
        state.statuses.set("Behind", "modified");
        const banner = await import("../src/gui/left-panel/projects/lockBanner");
        const r = project([behind]);
        expect(banner.lockBannerFor(r)?.count).toBe(1);

        vi.useFakeTimers();
        try {
            banner.pollLockBanners();
            const before = banner.getLockBannerRevision();
            state.busy = true;
            banner.pollLockBanners();
            // The busy edge rebuilds so the row leaves the tree at once.
            expect(banner.getLockBannerRevision()).toBe(before + 1);
            expect(state.dirtyMarks).toBe(1);
            expect(banner.lockBannerFor(r)).toBeNull();

            // An import rewrites the lock every step; none of that churn
            // should rebuild the tree while the task is still running.
            for (let i = 0; i < 3; i++) {
                vi.advanceTimersByTime(1500);
                state.mtimes.set(LOCK_PATH, 3000 + i);
                banner.pollLockBanners();
            }
            expect(banner.getLockBannerRevision()).toBe(before + 1);
            expect(state.dirtyMarks).toBe(1);
            expect(banner.lockBannerFor(r)).toBeNull();

            state.busy = false;
            banner.pollLockBanners();
            expect(banner.getLockBannerRevision()).toBe(before + 2);
            expect(state.dirtyMarks).toBe(2);
            expect(banner.lockBannerFor(r)).toEqual({ count: 1, lockMtime: 3002 });
        } finally {
            vi.useRealTimers();
        }
    });
});
