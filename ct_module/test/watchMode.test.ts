import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ImportQueueItem } from "../src/gui/right-panel/import-tab/queue";

const fixture = vi.hoisted(() => ({
    activeSources: new Set<string>(),
}));
const startImportIfIdle = vi.hoisted(() =>
    vi.fn((_rows: readonly ImportQueueItem[], _options: unknown) => true)
);

vi.mock("../src/settings", () => ({
    getWatchMode: () => true,
    setWatchMode: () => {},
}));
vi.mock("../src/gui/right-panel/import-tab/taskController", () => ({
    isImportPreparationRunning: () => false,
    startImportIfIdle,
}));
vi.mock("../src/gui/state", () => ({
    getAutoTrackSources: () => fixture.activeSources,
}));
vi.mock("../src/gui/autoTrackScope", () => ({
    getActiveAutoTrackSources: () => fixture.activeSources,
}));
vi.mock("../src/gui/toast", () => ({
    dismissToast: () => {},
    showToast: () => {},
}));
vi.mock("../src/gui/badge", () => ({ registerBadge: () => {} }));

import { watchModeRefresh } from "../src/gui/watchMode";
import {
    addToQueue,
    clearQueue,
    removeFromQueue,
} from "../src/gui/right-panel/import-tab/queue";

const PROJECT_A = "/projects/a/import.json";
const PROJECT_B = "/projects/b/import.json";

function queueItem(
    sourcePath: string,
    identity: string,
    type: "FUNCTION" | "ITEM" = "FUNCTION"
): ImportQueueItem {
    return {
        operation: "import",
        kind: "importable",
        sourcePath,
        type,
        identity,
        label: identity,
    };
}

function workKey(item: ImportQueueItem): string {
    if (item.kind !== "importable") throw new Error("Expected an importable row");
    return `${item.sourcePath}|${item.type}:${item.identity}`;
}

function queue(...items: readonly ImportQueueItem[]): void {
    for (const item of items) addToQueue(item);
}

function refresh(detected: readonly ImportQueueItem[]): void {
    watchModeRefresh(
        "reparse",
        detected.length,
        detected.length,
        detected.map(workKey),
        fixture.activeSources
    );
}

function startedRows(): readonly ImportQueueItem[] {
    return startImportIfIdle.mock.calls[0]?.[0] ?? [];
}

beforeEach(() => {
    vi.useFakeTimers();
    startImportIfIdle.mockClear();
    clearQueue();
    fixture.activeSources = new Set([PROJECT_A]);
});

afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    clearQueue();
});

describe("watch import debounce scope", () => {
    test("does not run a manually queued row from another project", () => {
        const changed = queueItem(PROJECT_A, "A");
        const manual = queueItem(PROJECT_B, "B");
        queue(changed, manual);

        refresh([changed]);
        vi.advanceTimersByTime(2000);

        expect(startedRows()).toEqual([changed]);
    });

    test("does not run a manually queued sibling from the same tracked root", () => {
        const changed = queueItem(PROJECT_A, "A");
        const manual = queueItem(PROJECT_A, "B");
        queue(changed, manual);

        refresh([changed]);
        vi.advanceTimersByTime(2000);

        expect(startedRows()).toEqual([changed]);
    });

    test("runs every detected row", () => {
        const first = queueItem(PROJECT_A, "A");
        const second = queueItem(PROJECT_A, "B");
        queue(first, second);

        refresh([first, second]);
        vi.advanceTimersByTime(2000);

        expect(startedRows()).toEqual([first, second]);
    });

    test("runs a detected required dependency key", () => {
        const changed = queueItem(PROJECT_A, "A");
        const dependency = queueItem(PROJECT_A, "Required Item", "ITEM");
        queue(changed, dependency);

        refresh([changed, dependency]);
        vi.advanceTimersByTime(2000);

        expect(startedRows()).toEqual([changed, dependency]);
    });

    test("does not substitute another row when the detected row is removed", () => {
        const changed = queueItem(PROJECT_A, "A");
        const manual = queueItem(PROJECT_A, "B");
        queue(changed, manual);

        refresh([changed]);
        removeFromQueue(changed);
        vi.advanceTimersByTime(2000);

        expect(startImportIfIdle).not.toHaveBeenCalled();
    });

    test("uses only the latest detected-key snapshot", () => {
        const first = queueItem(PROJECT_A, "A");
        const latest = queueItem(PROJECT_A, "B");
        queue(first, latest);

        refresh([first]);
        refresh([latest]);
        vi.advanceTimersByTime(2000);

        expect(startImportIfIdle).toHaveBeenCalledTimes(1);
        expect(startedRows()).toEqual([latest]);
    });
});
