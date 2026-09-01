import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const SOURCE_PATH = "/project/import.json";
const fixture = vi.hoisted<{
    status: "current" | "modified" | "unknown" | null;
    importable: {
        type: "FUNCTION";
        name: string;
        actions: never[];
    };
}>(() => ({
    status: "modified",
    importable: {
        type: "FUNCTION",
        name: "Spawn Raycast",
        actions: [],
    },
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

vi.mock("../src/gui/toast", () => ({ showToast: () => {} }));
vi.mock("../src/gui/autoRun", () => ({ autoRunRefresh: () => {} }));

import { autoTrackRefresh } from "../src/gui/autoTrack";
import {
    addToQueue,
    clearQueue,
    getQueue,
    makeImportableQueueItem,
} from "../src/gui/right-panel/import-tab/queue";

beforeEach(() => {
    clearQueue();
    fixture.status = "modified";
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

    test("leaves a manually queued current function alone", () => {
        fixture.status = "current";
        addToQueue(makeImportableQueueItem(fixture.importable, SOURCE_PATH));

        autoTrackRefresh("reparse");

        expect(getQueue()).toHaveLength(1);
    });
});
