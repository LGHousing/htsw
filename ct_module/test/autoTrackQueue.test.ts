import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const SOURCE_PATH = "/project/import.json";
const fixture = vi.hoisted<{
    status: "current" | "modified" | "unknown" | null;
    importable: {
        type: "FUNCTION";
        name: string;
        actions: never[];
    };
    armed: boolean;
    pendingRemovals: boolean;
    queueRunning: boolean;
}>(() => ({
    status: "modified",
    importable: {
        type: "FUNCTION",
        name: "Spawn Raycast",
        actions: [],
    },
    armed: false,
    pendingRemovals: false,
    queueRunning: false,
}));

vi.mock("@htsw/importer/runtime/state/index", () => ({
    getHousingUuid: () => "house-uuid",
    isAnyAutoTrackEnabled: () => true,
    isCurrentHouseTrusted: () => false,
}));

vi.mock("@htsw/importer/runtime/autoTrackScope", () => ({
    getActiveAutoTrackSources: () => new Set([SOURCE_PATH]),
}));

vi.mock("@htsw/importer/runtime/parsing/parses", () => ({
    canonicalPath: (path: string) => path,
    forEachCachedParse: (
        visit: (entry: {
            canonicalPath: string;
            parsed: {
                value: (typeof fixture.importable)[];
                importJson: { houseUuid: string };
            };
        }) => void
    ) => {
        visit({
            canonicalPath: SOURCE_PATH,
            parsed: {
                value: [fixture.importable, { ...fixture.importable, name: "Second" }],
                importJson: { houseUuid: "house-uuid" },
            },
        });
    },
    getParseCacheRevision: () => 0,
}));

vi.mock("@htsw/importer/importCache/importableStatus", () => ({
    cachedStatusForImportable: () => fixture.status,
    statusForImportableBlocking: () => fixture.status ?? "unknown",
}));

vi.mock("@htsw/importer/importCache/cacheWarm", () => ({
    onImportableCacheWarm: () => () => {},
}));

vi.mock("@htsw/importer/importables/import/dependencyExpansion", () => ({
    expandImportDependencies: (
        _parsed: unknown,
        modified: (typeof fixture.importable)[]
    ) => ({ importables: modified, addedImportables: [] }),
}));

vi.mock("@htsw/importer/runtime/autoRun", () => ({ autoRunRefresh: () => {} }));
vi.mock("@htsw/importer/settings", () => ({ getAutoRun: () => false }));
vi.mock("@htsw/importer/runtime/queueRunner", () => ({
    isQueueRunning: () => fixture.queueRunning,
}));
vi.mock("@htsw/importer/prune/projectRun", () => ({
    isArmedForPrune: () => fixture.armed,
    hasPendingRemovals: () => fixture.pendingRemovals,
    needsArmingScan: () => false,
    setOnArmingScansReset: () => {},
}));

import { autoTrackRefresh } from "@htsw/importer/runtime/autoTrack";
import {
    addToQueue,
    clearQueue,
    getQueue,
    makeImportableQueueRow,
    moveQueueRow,
    setQueueRowStatus,
} from "@htsw/importer/runtime/queue";

beforeEach(() => {
    clearQueue();
    fixture.status = "modified";
    fixture.armed = false;
    fixture.pendingRemovals = false;
    fixture.queueRunning = false;
});

afterEach(clearQueue);

describe("Auto-Track queue reconciliation", () => {
    test("removes an auto-queued function after it becomes current", () => {
        autoTrackRefresh("reparse");
        expect(getQueue()).toHaveLength(3);

        fixture.status = "current";
        autoTrackRefresh("reparse");

        expect(getQueue()).toHaveLength(0);
    });

    test("previews changed imports and preserves their order on refresh", () => {
        autoTrackRefresh("reparse");

        expect(getQueue()).toHaveLength(3);
        expect(getQueue()[0].target).toMatchObject({
            kind: "bulk",
            scope: { kind: "file", path: SOURCE_PATH },
            filter: "modified",
        });
        const [project, first, second] = getQueue();
        expect(first.parentKey).toBe(project.key);
        expect(second.parentKey).toBe(project.key);
        expect(moveQueueRow(second.key, "top", "house-uuid")).toBe(true);
        autoTrackRefresh("cacheWarm");
        expect(getQueue().map((row) => row.key)).toEqual([
            project.key,
            second.key,
            first.key,
        ]);
    });

    test("queues a project that claims its house when a save only removed things", () => {
        fixture.status = "current";
        autoTrackRefresh("reparse");
        expect(getQueue()).toHaveLength(0);

        fixture.armed = true;
        fixture.pendingRemovals = true;
        autoTrackRefresh("reparse");
        expect(getQueue()).toHaveLength(1);
    });

    test("a save retries a project that failed, but a cache tick does not", () => {
        autoTrackRefresh("reparse");
        const project = getQueue()[0];
        setQueueRowStatus(project.key, "failed", "boom");

        autoTrackRefresh("cacheWarm");
        expect(getQueue()[0].status).toBe("failed");

        fixture.queueRunning = true;
        autoTrackRefresh("reparse");
        expect(getQueue()[0].status).toBe("failed");

        fixture.queueRunning = false;
        autoTrackRefresh("reparse");
        expect(getQueue()[0].status).toBe("queued");
    });

    test("leaves a manually queued current function alone", () => {
        fixture.status = "current";
        addToQueue(
            makeImportableQueueRow({
                op: "import",
                house: "house-uuid",
                path: SOURCE_PATH,
                type: "FUNCTION",
                identity: fixture.importable.name,
            })
        );

        autoTrackRefresh("reparse");

        expect(getQueue()).toHaveLength(1);
    });
});
