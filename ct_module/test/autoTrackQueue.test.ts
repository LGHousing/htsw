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

vi.mock("../src/gui/state", () => ({
    getHousingUuid: () => "house-uuid",
    isAnyAutoTrackEnabled: () => true,
    isCurrentHouseTrusted: () => false,
}));

vi.mock("../src/gui/autoTrackScope", () => ({
    getActiveAutoTrackSources: () => new Set([SOURCE_PATH]),
}));

vi.mock("../src/gui/parsing/parses", () => ({
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
                value: [fixture.importable],
                importJson: { houseUuid: "house-uuid" },
            },
        });
    },
    getParseCacheRevision: () => 0,
}));

vi.mock("../src/gui/cache-status", () => ({
    cachedStatusForImportable: () => fixture.status,
    statusForImportableBlocking: () => fixture.status ?? "unknown",
}));

vi.mock("../src/gui/cache-status/cacheWarm", () => ({
    onImportableCacheWarm: () => () => {},
}));

vi.mock("../src/importables/import/dependencyExpansion", () => ({
    expandImportDependencies: (
        _parsed: unknown,
        modified: (typeof fixture.importable)[]
    ) => ({ importables: modified, addedImportables: [] }),
}));

vi.mock("../src/gui/autoRun", () => ({ autoRunRefresh: () => {} }));
vi.mock("../src/settings", () => ({ getAutoRun: () => false }));
vi.mock("../src/gui/right-panel/import-tab/queueRunner", () => ({
    isQueueRunning: () => fixture.queueRunning,
}));
vi.mock("../src/prune/projectRun", () => ({
    isArmedForPrune: () => fixture.armed,
    hasPendingRemovals: () => fixture.pendingRemovals,
    needsArmingScan: () => false,
    setOnArmingScansReset: () => {},
}));

import { autoTrackRefresh } from "../src/gui/autoTrack";
import {
    addToQueue,
    clearQueue,
    getQueue,
    makeImportableQueueRow,
    setQueueRowStatus,
} from "../src/gui/right-panel/import-tab/queue";

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
        expect(getQueue()).toHaveLength(1);

        fixture.status = "current";
        autoTrackRefresh("reparse");

        expect(getQueue()).toHaveLength(0);
    });

    test("queues the whole project as one row", () => {
        autoTrackRefresh("reparse");

        expect(getQueue()).toHaveLength(1);
        expect(getQueue()[0].target).toMatchObject({
            kind: "bulk",
            scope: { kind: "file", path: SOURCE_PATH },
            filter: "modified",
        });
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
