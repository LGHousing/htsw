import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const progress = {
        start: vi.fn(),
        sinkFor: vi.fn(),
        complete: vi.fn(),
        fail: vi.fn(),
        clear: vi.fn(),
    };
    return {
        createProgress: vi.fn(() => progress),
        parse: vi.fn(() => ({ value: [], diagnostics: [] })),
        progress,
        runTask: vi.fn(() => Promise.resolve(undefined)),
    };
});

vi.mock("htsw", async (importOriginal) => ({
    ...(await importOriginal<typeof import("htsw")>()),
    parseImportablesResult: mocks.parse,
}));
vi.mock("../src/tasks/manager", () => ({
    TaskManager: { isBusy: () => false },
}));
vi.mock("../src/housingSync/taskRunner", () => ({
    runHousingSyncTask: mocks.runTask,
}));
vi.mock("../src/gui/right-panel/import-tab/diffProgress", () => ({
    createDiffProgressSession: mocks.createProgress,
}));

import { commandDiff } from "../src/slashCommands/diff";

describe("diff command progress", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("FileLib", {
            exists: () => true,
            read: () => null,
            write: () => undefined,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test("clears progress when task cancellation resolves undefined", async () => {
        commandDiff(["/tmp/import.json"]);
        await Promise.resolve();
        await Promise.resolve();

        expect(mocks.runTask).toHaveBeenCalledWith("diff", expect.any(Function));
        expect(mocks.progress.clear).toHaveBeenCalledOnce();
        expect(mocks.progress.fail).not.toHaveBeenCalled();
    });
});
