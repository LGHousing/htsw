import { beforeEach, describe, expect, test, vi } from "vitest";
import * as htsw from "htsw";
import type { Action } from "htsw/types";

import type { ItemCaptureSink } from "../src/housingSync/items/capture";
import { StringFileLoader } from "../src/utils/fileLoaders";

type TestTaskContext = {
    tryGetMenuItemSlot: () => object | null;
};

type TestActionReadOptions = {
    itemCaptures: ItemCaptureSink;
};

const mocks = vi.hoisted(() => ({
    atomicWriteText: vi.fn<
        (
            path: string,
            content: string,
            options?: { replaceExisting?: boolean }
        ) => boolean
    >(() => true),
    isBusy: vi.fn(() => false),
    openDestination: vi.fn(),
    readActionListFully:
        vi.fn<
            (
                ctx: TestTaskContext,
                read: TestActionReadOptions
            ) => Promise<readonly Action[]>
        >(),
    runHousingSyncTask:
        vi.fn<
            (
                kind: "export",
                task: (ctx: TestTaskContext) => Promise<unknown>
            ) => Promise<unknown>
        >(),
    showToast: vi.fn(),
    chat: vi.fn(),
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
        vi.stubGlobal("ChatLib", { chat: mocks.chat });
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

        await exportOpenActionListTo("/project/button.htsl", false);

        expect(mocks.readActionListFully).not.toHaveBeenCalled();
        expect(mocks.atomicWriteText).not.toHaveBeenCalled();
    });

    test("does not write when the full Housing read fails", async () => {
        mocks.readActionListFully.mockRejectedValue(new Error("nested read failed"));

        await exportOpenActionListTo("/project/button.htsl", false);

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

        await exportOpenActionListTo("/project/button.htsl", false);

        expect(mocks.atomicWriteText).toHaveBeenCalledOnce();
        const [path, source] = mocks.atomicWriteText.mock.calls[0];
        expect(path).toBe("/project/button.htsl");
        expect(mocks.atomicWriteText).toHaveBeenCalledWith(path, source, {
            replaceExisting: false,
        });
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

    test("writes a captured custom item before the HTSL", async () => {
        const custom =
            '{id:"minecraft:diamond_sword",Count:1b,Damage:0s,tag:{display:{Name:"Magic Sword"},custom:1b}}';
        mocks.readActionListFully.mockImplementation(async (_ctx, read) => [
            {
                type: "GIVE_ITEM",
                itemName: read.itemCaptures.register(custom, "Magic Sword"),
                allowMultiple: false,
                inventorySlot: "First Available Slot",
                replaceExistingItem: false,
            },
        ]);

        await exportOpenActionListTo("/project/button.htsl", false);

        expect(mocks.atomicWriteText).toHaveBeenCalledTimes(2);
        expect(mocks.atomicWriteText.mock.calls[0][0]).toBe(
            "/project/items/magic_sword.snbt"
        );
        expect(mocks.atomicWriteText.mock.calls[0][2]).toEqual({
            replaceExisting: false,
        });
        expect(mocks.atomicWriteText.mock.calls[1][0]).toBe("/project/button.htsl");
        expect(mocks.atomicWriteText.mock.calls[1][1]).toContain(
            "giveItem items/magic_sword.snbt"
        );
        expect(mocks.chat).toHaveBeenCalledWith(
            expect.stringContaining("(+1 item file)")
        );
        expect(mocks.chat).toHaveBeenCalledWith(
            expect.stringContaining("Custom items were written as inline .snbt files")
        );
        expect(mocks.chat).not.toHaveBeenCalledWith(
            expect.stringContaining("raw interact_data")
        );
    });

    test("warns when a written item contains click actions", async () => {
        const withClickActions =
            '{id:"minecraft:diamond_sword",Count:1b,Damage:0s,tag:{display:{Name:"Magic Sword"},ExtraAttributes:{interact_data:{version:1}}}}';
        mocks.readActionListFully.mockImplementation(async (_ctx, read) => [
            {
                type: "GIVE_ITEM",
                itemName: read.itemCaptures.register(withClickActions, "Magic Sword"),
                allowMultiple: false,
                inventorySlot: "First Available Slot",
                replaceExistingItem: false,
            },
        ]);

        await exportOpenActionListTo("/project/button.htsl", false);

        expect(mocks.chat).toHaveBeenCalledWith(
            "&e[htsw] 1 item includes click actions as raw interact_data in their .snbt; they reimport correctly only into this house, and those click actions are not editable HTSL."
        );
    });

    test("a vanilla-only export writes only the unchanged HTSL behavior", async () => {
        mocks.readActionListFully.mockImplementation(async (_ctx, read) => [
            {
                type: "GIVE_ITEM",
                itemName: read.itemCaptures.register(
                    '{id:"minecraft:stone",Count:1b,Damage:0s}',
                    "Stone"
                ),
                allowMultiple: false,
                inventorySlot: "First Available Slot",
                replaceExistingItem: false,
            },
        ]);

        await exportOpenActionListTo("/project/button.htsl", false);

        expect(mocks.atomicWriteText).toHaveBeenCalledOnce();
        expect(mocks.atomicWriteText.mock.calls[0][0]).toBe("/project/button.htsl");
        expect(mocks.atomicWriteText.mock.calls[0][1]).toContain(
            'giveItem "minecraft:stone"'
        );
        expect(mocks.chat).not.toHaveBeenCalledWith(expect.stringContaining("item file"));
        expect(mocks.chat).not.toHaveBeenCalledWith(
            expect.stringContaining("Custom items")
        );
    });
});
