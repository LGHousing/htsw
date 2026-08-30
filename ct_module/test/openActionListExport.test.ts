import { beforeEach, describe, expect, test, vi } from "vitest";
import * as htsw from "htsw";
import type { Action } from "htsw/types";

import { StringFileLoader } from "../src/utils/fileLoaders";

type TestTaskContext = {
    tryGetMenuItemSlot: () => object | null;
};

const mocks = vi.hoisted(() => ({
    atomicWriteText: vi.fn<(path: string, content: string) => boolean>(() => true),
    isBusy: vi.fn(() => false),
    openDestination: vi.fn(),
    readActionListFully: vi.fn(),
    runHousingSyncTask:
        vi.fn<
            (
                kind: "export",
                task: (ctx: TestTaskContext) => Promise<unknown>
            ) => Promise<unknown>
        >(),
    showToast: vi.fn(),
    tryGetMenuItemSlot: vi.fn<() => object | null>(() => ({})),
}));

vi.mock("../src/utils/filesystem", () => ({
    atomicWriteText: mocks.atomicWriteText,
}));

vi.mock("../src/housingSync/actions/hydration/run", () => ({
    readActionListFully: mocks.readActionListFully,
}));

vi.mock("../src/housingSync/taskRunner", () => ({
    runHousingSyncTask: mocks.runHousingSyncTask,
}));

vi.mock("../src/tasks/manager", () => ({
    TaskManager: { isBusy: mocks.isBusy },
}));

vi.mock("../src/gui/popovers/file-browser", () => ({
    openFileBrowserWithHtslDestination: mocks.openDestination,
}));

vi.mock("../src/gui/toast", () => ({
    showToast: mocks.showToast,
}));

import {
    exportOpenActionListTo,
    startOpenActionListExport,
} from "../src/gui/export/openActionListExport";

describe("open action-list export", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isBusy.mockReturnValue(false);
        mocks.tryGetMenuItemSlot.mockReturnValue({});
        mocks.atomicWriteText.mockReturnValue(true);
        mocks.runHousingSyncTask.mockImplementation(async (_kind, task) =>
            task({ tryGetMenuItemSlot: mocks.tryGetMenuItemSlot })
        );
    });

    test("waits for a destination and cancellation starts no Housing task", () => {
        startOpenActionListExport();

        expect(mocks.openDestination).toHaveBeenCalledOnce();
        expect(mocks.runHousingSyncTask).not.toHaveBeenCalled();
        expect(mocks.readActionListFully).not.toHaveBeenCalled();
        expect(mocks.atomicWriteText).not.toHaveBeenCalled();
    });

    test("rejects an unsupported menu without reading or writing", async () => {
        mocks.tryGetMenuItemSlot.mockReturnValue(null);

        await exportOpenActionListTo("/project/button.htsl");

        expect(mocks.readActionListFully).not.toHaveBeenCalled();
        expect(mocks.atomicWriteText).not.toHaveBeenCalled();
    });

    test("does not write when the full Housing read fails", async () => {
        mocks.readActionListFully.mockRejectedValue(new Error("nested read failed"));

        await exportOpenActionListTo("/project/button.htsl");

        expect(mocks.readActionListFully).toHaveBeenCalledOnce();
        expect(mocks.atomicWriteText).not.toHaveBeenCalled();
    });

    test("writes complete nested actions as standalone parseable HTSL", async () => {
        const actions: Action[] = [
            { type: "MESSAGE", message: "top level" },
            {
                type: "RANDOM",
                actions: [{ type: "MESSAGE", message: "nested" }],
            },
        ];
        mocks.readActionListFully.mockResolvedValue(actions);

        await exportOpenActionListTo("/project/button.htsl");

        expect(mocks.atomicWriteText).toHaveBeenCalledOnce();
        const [path, source] = mocks.atomicWriteText.mock.calls[0];
        expect(path).toBe("/project/button.htsl");
        const parsed = htsw.parseActionsResult(
            new htsw.SourceMap(new StringFileLoader(source)),
            "button.htsl"
        );
        expect(
            parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")
        ).toEqual([]);
        expect(parsed.value).toEqual(actions);
        expect(mocks.readActionListFully.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.atomicWriteText.mock.invocationCallOrder[0]
        );
    });
});
