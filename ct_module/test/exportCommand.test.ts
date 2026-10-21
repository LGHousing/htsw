import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
    house: null as string | null,
    rows: [] as Array<Record<string, unknown>>,
    lookups: 0,
}));

vi.mock("@htsw/importer/runtime/state/index", () => ({
    getHousingUuid: () => state.house,
    setHousingUuid: (uuid: string | null) => {
        state.house = uuid;
    },
}));
vi.mock("@htsw/importer/importCache/housingId", () => ({
    getCurrentHousingUuid: async () => {
        state.lookups++;
        return "resolved-house";
    },
}));
vi.mock("@htsw/importer/housingSync/taskRunner", () => ({
    runHousingSyncTask: (_kind: string, task: (ctx: unknown) => Promise<unknown>) =>
        task({}),
}));
vi.mock("../src/slashCommands/exportDestination", () => ({
    queuedExportDestination: (_path: string | undefined, house: string) => ({
        importJsonPath: `/exports/${house}/import.json`,
    }),
}));
vi.mock("@htsw/importer/runtime/queue", () => ({
    addQueueRow: (row: Record<string, unknown>) => {
        state.rows.push(row);
        return { kind: "added", row, message: "Queued" };
    },
    makeBulkQueueRow: (args: Record<string, unknown>) => args,
    makeImportableQueueRow: (args: Record<string, unknown>) => args,
}));
vi.mock("@htsw/importer/runtime/autoRun", () => ({ autoRunQueueChanged: () => {} }));
vi.mock("@htsw/importer/runtime/queueRunner", () => ({ pauseQueue: () => null }));
vi.mock("@htsw/importer/runtime/parsing/parses", () => ({}));
vi.mock("../src/importables/menus/exportChest", () => ({}));
vi.mock("@htsw/importer/importables/export/projectDestination", () => ({}));
vi.mock("../src/slashCommands/exportHelp", () => ({ printExportHelp: () => {} }));
vi.mock("@htsw/importer/bridge/status", () => ({ emitBridgeEvent: () => {} }));
vi.mock("@htsw/importer/project/paths", () => ({ parentDirOf: () => "" }));
vi.mock("@htsw/importer/importables/export/exportTypes", () => ({
    houseExportTypeByToken: (token: string | undefined) =>
        token === "function" ? { type: "FUNCTION", named: true } : null,
}));

import { commandExport } from "../src/slashCommands/export";

beforeEach(() => {
    state.house = null;
    state.rows = [];
    state.lookups = 0;
    vi.stubGlobal("ChatLib", { chat: () => {} });
});

test("an export with no known house finds it with /wtfmap, then queues", async () => {
    commandExport(["function", "Foo"]);
    await vi.waitFor(() => expect(state.rows).toHaveLength(1));

    expect(state.lookups).toBe(1);
    expect(state.house).toBe("resolved-house");
    expect(state.rows[0]).toMatchObject({
        op: "export",
        house: "resolved-house",
        path: "/exports/resolved-house/import.json",
        type: "FUNCTION",
        identity: "Foo",
    });
});
