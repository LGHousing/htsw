import { beforeEach, describe, expect, it, vi } from "vitest";

const mtimes = new Map<string, number>();

vi.mock("../src/gui/lib/java", () => ({
    getMtimeMs: (path: string) => mtimes.get(path) ?? 0,
}));

import {
    FP_RECHECK_MS,
    createFreshness,
    isFreshnessCheckDue,
    settledChange,
    type Fingerprint,
} from "../src/gui/parsing/freshness";

function completeSweep(
    fingerprint: Fingerprint,
    freshness: ReturnType<typeof createFreshness>,
    tickMs = 0
): boolean {
    let changed = settledChange(fingerprint, freshness);
    while (freshness.sweep !== null) {
        if (tickMs > 0) vi.advanceTimersByTime(tickMs);
        changed = settledChange(fingerprint, freshness);
    }
    return changed;
}

beforeEach(() => {
    mtimes.clear();
    vi.useFakeTimers();
    vi.setSystemTime(0);
});

describe("fingerprint freshness", () => {
    it("leaves real idle time after sweeping a large stable fingerprint", () => {
        const fingerprint: Fingerprint = {};
        for (let i = 0; i < 696; i++) {
            const path = `/project/file-${i}.htsl`;
            fingerprint[path] = 1;
            mtimes.set(path, 1);
        }
        const freshness = createFreshness();

        vi.advanceTimersByTime(FP_RECHECK_MS);
        expect(completeSweep(fingerprint, freshness, 50)).toBe(false);
        expect(freshness.pending).toBeNull();
        expect(freshness.sweep).toBeNull();

        const idleMs = Math.max(FP_RECHECK_MS, freshness.lastSweepDurationMs);
        vi.advanceTimersByTime(idleMs - 1);
        expect(isFreshnessCheckDue(freshness)).toBe(false);
        vi.advanceTimersByTime(1);
        expect(isFreshnessCheckDue(freshness)).toBe(true);
    });

    it("detects a real mtime change after it settles", () => {
        const path = "/project/function.htsl";
        const fingerprint = { [path]: 1 };
        mtimes.set(path, 2);
        const freshness = createFreshness();

        vi.advanceTimersByTime(FP_RECHECK_MS);
        expect(completeSweep(fingerprint, freshness)).toBe(false);
        expect(freshness.pending).toEqual({ [path]: 2 });

        vi.advanceTimersByTime(FP_RECHECK_MS);
        expect(completeSweep(fingerprint, freshness)).toBe(true);
        expect(freshness.pending).toBeNull();
    });

    it("detects a fingerprint key added between settle sweeps", () => {
        const changedPath = "/project/changed.htsl";
        const addedPath = "/project/added.htsl";
        const fingerprint: Fingerprint = { [changedPath]: 1 };
        mtimes.set(changedPath, 2);
        mtimes.set(addedPath, 1);
        const freshness = createFreshness();

        vi.advanceTimersByTime(FP_RECHECK_MS);
        expect(completeSweep(fingerprint, freshness)).toBe(false);
        fingerprint[addedPath] = 1;

        vi.advanceTimersByTime(FP_RECHECK_MS);
        expect(completeSweep(fingerprint, freshness)).toBe(false);
        expect(freshness.pending).toEqual({
            [changedPath]: 2,
            [addedPath]: 1,
        });
    });

    it("detects a fingerprint key removed during a sweep", () => {
        const fingerprint: Fingerprint = {};
        for (let i = 0; i < 17; i++) {
            const path = `/project/file-${i}.htsl`;
            fingerprint[path] = 1;
            mtimes.set(path, 1);
        }
        const removedPath = "/project/file-16.htsl";
        const freshness = createFreshness();

        vi.advanceTimersByTime(FP_RECHECK_MS);
        expect(settledChange(fingerprint, freshness)).toBe(false);
        delete fingerprint[removedPath];
        expect(completeSweep(fingerprint, freshness)).toBe(false);
        expect(freshness.pending).not.toBeNull();
        expect(freshness.pending?.[removedPath]).toBe(1);
    });
});
