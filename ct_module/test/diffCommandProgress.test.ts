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
        parse: vi.fn<() => Promise<unknown>>(),
        house: vi.fn(),
        checkCancelled: vi.fn(),
        progress,
        runTask: vi.fn((_kind: string, task: (ctx: unknown) => Promise<unknown>) =>
            task({ checkCancelled: mocks.checkCancelled }).catch(() => undefined)
        ),
    };
});

vi.mock("../src/gui/parsing/parses", () => ({
    canonicalPath: (path: string) => path,
    parseImportJsonCurrent: mocks.parse,
}));
vi.mock("../src/importCache/housingId", () => ({ getCurrentHousingUuid: mocks.house }));
vi.mock("../src/tasks/manager", () => ({
    TaskManager: { isBusy: () => false },
}));
vi.mock("../src/housingSync/taskRunner", () => ({
    runHousingSyncTask: mocks.runTask,
}));
vi.mock("../src/runtime/diffProgress", () => ({
    createDiffProgressSession: mocks.createProgress,
}));

import { commandDiff } from "../src/slashCommands/diff";

describe("diff command progress", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.checkCancelled.mockReset();
        mocks.parse.mockResolvedValue({
            parsed: { value: [], diagnostics: [] },
            error: null,
        });
        mocks.house.mockRejectedValue(new Error("cancelled"));
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
        await vi.waitFor(() => expect(mocks.progress.clear).toHaveBeenCalledOnce());

        expect(mocks.runTask).toHaveBeenCalledWith("diff", expect.any(Function), {
            diagnostic: "htsw_diff",
        });
        expect(mocks.progress.clear).toHaveBeenCalledOnce();
        expect(mocks.progress.fail).not.toHaveBeenCalled();
    });
    test("reserves the task while parsing and does not contact Housing early", async () => {
        let finish!: (entry: unknown) => void;
        mocks.parse.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        commandDiff(["/tmp/import.json"]);
        expect(mocks.runTask).toHaveBeenCalledOnce();
        expect(mocks.parse).toHaveBeenCalledOnce();
        expect(mocks.house).not.toHaveBeenCalled();
        expect(mocks.createProgress).not.toHaveBeenCalled();
        finish({ parsed: { value: [], diagnostics: [] }, error: null });
        await vi.waitFor(() => expect(mocks.house).toHaveBeenCalledOnce());
    });

    test("a failed parse does not begin reading the house", async () => {
        mocks.parse.mockResolvedValue({ parsed: null, error: "bad manifest" });
        commandDiff(["/tmp/import.json"]);
        await vi.waitFor(() => expect(mocks.checkCancelled).toHaveBeenCalled());
        expect(mocks.house).not.toHaveBeenCalled();
        expect(mocks.createProgress).not.toHaveBeenCalled();
    });

    test("cancellation while parsing is checked before reading the house", async () => {
        mocks.checkCancelled.mockImplementation(() => {
            throw new Error("cancelled");
        });
        commandDiff(["/tmp/import.json"]);
        await vi.waitFor(() => expect(mocks.checkCancelled).toHaveBeenCalled());
        expect(mocks.house).not.toHaveBeenCalled();
    });
});
