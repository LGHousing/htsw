import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
    rows: [] as Array<Record<string, unknown>>,
    starts: 0,
    pauses: 0,
    autoRun: null as boolean | null,
    changed: 0,
    retries: [] as string[],
}));

vi.mock("../src/gui/autoRun", () => ({
    autoRunQueueChanged: () => state.changed++,
    setAutoRunEnabled: (enabled: boolean) => {
        state.autoRun = enabled;
    },
}));
vi.mock("../src/gui/export/destinationStatus", () => ({
    getExportDestinationStatus: () => ({
        kind: "ready",
        path: "/project/import.json",
    }),
}));
vi.mock("../src/gui/lib/pathDisplay", () => ({ compactFileLabel: (v: string) => v }));
vi.mock("../src/gui/parsing/parses", () => ({
    parseImportJsonCurrent: async (path: string) => ({
        canonicalPath: path,
        parsed: { importJson: { houseUuid: "house" }, value: [] },
        error: null,
    }),
    parseImportJsonCurrentBlocking: (path: string) => ({
        canonicalPath: path,
        parsed: { importJson: { houseUuid: "house" }, value: [] },
        error: null,
    }),
}));
vi.mock("../src/gui/state", () => ({ getHousingUuid: () => "house" }));
vi.mock("../src/gui/right-panel/import-tab/queue", () => ({
    addQueueRow: (row: Record<string, unknown>) => {
        state.rows.push(row);
        return { kind: "added", row, message: "Queued" };
    },
    clearQueue: () => {
        state.rows = [];
    },
    getQueue: () => state.rows,
    makeBulkQueueRow: (args: Record<string, unknown>) => ({
        ...args,
        key: "bulk",
        target: {
            kind: "bulk",
            scope: args.scope,
            filter: args.filter,
            label: args.label,
        },
        status: "queued",
    }),
    makeImportableQueueRow: (args: Record<string, unknown>) => ({
        ...args,
        key: "importable",
        target: {
            kind: "importable",
            type: args.type,
            identity: args.identity,
            label: args.label,
        },
        status: "queued",
    }),
    removeQueueRow: () => true,
    retryQueueRow: (key: string) => {
        state.retries.push(key);
        return true;
    },
}));
vi.mock("../src/gui/right-panel/import-tab/queueRunner", () => ({
    isQueueRunning: () => false,
    pauseQueue: () => {
        state.pauses++;
        return "requested";
    },
    startQueue: () => {
        state.starts++;
        return true;
    },
}));
vi.mock("../src/importCache/aliases", () => ({ houseDisplayName: (v: string) => v }));
vi.mock("../src/importables/export/readers", () => ({
    HOUSE_READABLE_TYPES: [
        "FUNCTION",
        "EVENT",
        "MENU",
        "REGION",
        "COMMAND",
        "TEAM",
        "GROUP",
        "NPC",
    ],
}));
vi.mock("../src/project/paths", () => ({ resolveModuleRelativePath: (v: string) => v }));
vi.mock("../src/settings", () => ({ getAutoRun: () => false }));

import { commandQueue } from "../src/slashCommands/queue";

describe("queue slash commands", () => {
    beforeEach(() => {
        state.rows = [];
        state.starts = 0;
        state.pauses = 0;
        state.autoRun = null;
        state.changed = 0;
        state.retries = [];
        vi.stubGlobal("ChatLib", { chat: () => {} });
        vi.stubGlobal("FileLib", { exists: () => true });
    });

    test("queues a filtered export bulk row", () => {
        commandQueue(["export", "FUNCTION", "new"]);

        expect(state.rows[0]).toMatchObject({
            op: "export",
            house: "house",
            path: "/project/import.json",
            target: {
                kind: "bulk",
                scope: { kind: "houseType", type: "FUNCTION" },
                filter: "new",
            },
        });
        expect(state.changed).toBe(1);
    });

    test("queues a concrete read row", () => {
        commandQueue(["read", "MENU", "Main Menu"]);

        expect(state.rows[0]).toMatchObject({
            op: "read",
            target: {
                kind: "importable",
                type: "MENU",
                identity: "Main Menu",
            },
        });
    });

    test("queues a changed read bulk row", () => {
        commandQueue(["read", "FUNCTION", "changed"]);

        expect(state.rows[0]).toMatchObject({
            op: "read",
            target: {
                kind: "bulk",
                scope: { kind: "houseType", type: "FUNCTION" },
                filter: "changed",
            },
        });
    });

    test("retries a row by one-based queue index", () => {
        state.rows.push({ key: "failed-row", status: "failed" });

        commandQueue(["retry", "1"]);

        expect(state.retries).toEqual(["failed-row"]);
    });

    test("runs, pauses, and toggles Auto-run through queue commands", () => {
        state.rows.push({ key: "queued" });

        commandQueue(["run"]);
        commandQueue(["pause"]);
        commandQueue(["autorun", "on"]);

        expect(state.starts).toBe(1);
        expect(state.pauses).toBe(1);
        expect(state.autoRun).toBe(true);
    });

    test("rejects invalid Auto-run values", () => {
        commandQueue(["autorun", "maybe"]);

        expect(state.autoRun).toBeNull();
    });

    test("rejects invalid export filter and type combinations", () => {
        commandQueue(["export", "FUNCTION", "modified"]);
        commandQueue(["export", "ITEM", "all"]);

        expect(state.rows).toEqual([]);
    });
});
