import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    back: vi.fn(async () => undefined),
    write: vi.fn<(...args: unknown[]) => Promise<void>>(),
    actionIo: vi.fn(),
    slotAt: vi.fn(),
    visible: vi.fn(),
    add: vi.fn(),
    readList: vi.fn(async () => [] as { index: number }[]),
}));
vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(async () => undefined),
    waitForMenu: vi.fn(async () => undefined),
}));
vi.mock("../src/housingSync/menus/menuUtils", async (original) => ({
    ...(await original<typeof import("../src/housingSync/menus/menuUtils")>()),
    clickGoBack: mocks.back,
    getSlotPaginate: vi.fn(async () => ({ click: mocks.add })),
    isLimitExceeded: vi.fn(() => false),
}));
vi.mock("../src/housingSync/menus/paginatedList", async (original) => ({
    ...(await original<typeof import("../src/housingSync/menus/paginatedList")>()),
    getPaginatedListSlotAtIndex: mocks.slotAt,
    getVisiblePaginatedItemSlots: mocks.visible,
    readPaginatedList: mocks.readList,
    goToPaginatedListPage: vi.fn(async () => undefined),
}));
vi.mock("../src/housingSync/actions/io", () => ({
    getActionIo: mocks.actionIo,
    writeOpenAction: async (...args: unknown[]) => {
        const result = mocks.write(...args);
        cycled = true;
        return result;
    },
}));

import {
    addAction,
    appendActionsToOpenActionList,
} from "../src/housingSync/actions/apply/actionOps";
import { CycleFieldReadError, setCycleValue } from "../src/housingSync/menus/menuUtils";
import { MouseButton } from "../src/tasks/specifics/slots";

const missing = () =>
    new Error(
        'Could not find "Holder" in "Action Settings" (slots: Head, Team, Variable, Operation, Value, Automatic Unset, Go Back, Note)'
    );
const action = {
    type: "CHANGE_VAR",
    holder: { type: "Team", team: "T2" },
    key: "z31",
    op: "Multiply",
    value: "7",
} as const;
let title = "Actions: Proof";
let listTitle = "Actions: Proof";
let childList = false;
let editor = false;
let parentName: string | undefined;
let cycled = false;
const removed = new Set<string>();
const ctx = {
    getOpenContainerTitle: vi.fn(() => title),
    getMenuItemSlot: vi.fn(() => ({ click: vi.fn() })),
    tryGetMenuItemSlot: vi.fn(() => ({})),
};
const slot = {
    getSlotId: () => 10,
    getItem: () => ({
        getName: () => "Change Variable",
        getLore: () =>
            cycled
                ? ["Holder: Team", "Team: None", "Variable: Kills"]
                : ["Holder: Player", "Variable: Kills"],
    }),
    click: vi.fn<(button?: MouseButton) => void>(),
};
const parentSlot = {
    getSlotId: () => 10,
    getItem: () => ({ getName: () => parentName!, getLore: () => ["Actions: keep"] }),
    click: vi.fn<(button?: MouseButton) => void>(),
};
const apply = () => addAction(ctx as never, action, vi.fn() as never, {} as never, 0);

beforeEach(() => {
    vi.clearAllMocks();
    mocks.write.mockReset();
    cycled = false;
    title = listTitle = "Actions: Proof";
    childList = editor = false;
    parentName = undefined;
    removed.clear();
    ctx.getOpenContainerTitle.mockReset().mockImplementation(() => title);
    mocks.actionIo.mockImplementation((type: string) => {
        const displayName =
            type === "RANDOM"
                ? "Random Action"
                : type === "CONDITIONAL"
                  ? "Conditional"
                  : "Change Variable";
        if (type !== "CHANGE_VAR") parentName = displayName;
        return { displayName, write: true };
    });
    mocks.add.mockImplementation(() => {
        cycled = false;
        editor = true;
        title = "Action Settings";
    });
    mocks.back.mockImplementation(async () => {
        if (!editor && childList) {
            childList = false;
            editor = true;
        } else editor = false;
        title = editor ? "Action Settings" : childList ? "Actions: New child" : listTitle;
    });
    mocks.readList.mockResolvedValue([]);
    const current = () => (!childList && parentName ? parentSlot : slot);
    mocks.slotAt.mockImplementation(async () => current());
    mocks.visible.mockImplementation(() =>
        removed.has(childList ? "child" : "root") ? [] : [current()]
    );
    const click = (button?: MouseButton) => {
        if (button === MouseButton.RIGHT) removed.add(childList ? "child" : "root");
        else {
            editor = true;
            title = "Action Settings";
        }
    };
    slot.click.mockImplementation(click);
    parentSlot.click.mockImplementation(click);
});

test("a failed read after a cycle carries the original diagnostic and field name", async () => {
    let clicked = false;
    const item = {
        getName: () => "Holder",
        getLore: () => ["Player", "Global", "Team", "➠ Player"],
    };
    const cycle = {
        getItem: () => item,
        click: vi.fn(() => {
            clicked = true;
        }),
    };
    const cycleCtx = {
        tryGetMenuItemSlot: (name: unknown) =>
            !clicked && name === "Holder" ? cycle : null,
        getMenuItemSlot: () => {
            throw missing();
        },
    };
    await expect(
        setCycleValue(cycleCtx as never, "Holder", ["Player", "Global", "Team"], "Team")
    ).rejects.toMatchObject({
        name: "CycleFieldReadError",
        slotName: "Holder",
        message: missing().message,
    });
    expect(cycle.click).toHaveBeenCalledExactlyOnceWith(MouseButton.RIGHT);
});

test("reopens the addition and then writes it without adding another action", async () => {
    mocks.write
        .mockRejectedValueOnce(new CycleFieldReadError("Holder", missing()))
        .mockResolvedValueOnce(undefined);
    await apply();
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.slotAt).toHaveBeenCalledWith(ctx, 0, 1, expect.anything());
    expect(slot.click.mock.calls.map((args) => args[0])).toEqual([undefined, undefined]);
});

test("three failed reopens delete the addition before throwing", async () => {
    mocks.write
        .mockRejectedValueOnce(new CycleFieldReadError("Holder", missing()))
        .mockRejectedValue(missing());
    await expect(apply()).rejects.toThrow(
        "Holder recovery exhausted after 3 reopens; removed"
    );
    expect(mocks.write).toHaveBeenCalledTimes(4);
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(slot.click.mock.calls.map((args) => args[0])).toEqual([
        undefined, // checkpoint reopen before the cycle
        undefined,
        undefined,
        undefined,
        MouseButton.RIGHT,
    ]);
});

test("a missing Holder before any cycle does not enter recovery or delete an action", async () => {
    mocks.write.mockRejectedValueOnce(missing());
    await expect(apply()).rejects.toThrow('Could not find "Holder"');
    expect(mocks.slotAt).toHaveBeenCalledTimes(1);
    expect(slot.click).toHaveBeenCalledExactlyOnceWith();
});

test("a swap before the first recovery read is never reopened or deleted", async () => {
    mocks.write
        .mockRejectedValueOnce(new CycleFieldReadError("Holder", missing()))
        .mockRejectedValue(missing());
    const swapped = {
        ...slot,
        getItem: () => ({
            getName: () => "Change Variable",
            getLore: () => ["Holder: Team", "Variable: another writer"],
        }),
    };
    mocks.slotAt.mockImplementation(async () => (cycled ? swapped : slot));
    await expect(apply()).rejects.toThrow(
        `${missing().message}; The newly added Change Variable action changed during Holder recovery.`
    );
    expect(slot.click.mock.calls.map((args) => args[0])).toEqual([undefined]);
});

test("raw append recovers the new action after the existing paginated list", async () => {
    mocks.readList.mockResolvedValue(
        Array.from({ length: 25 }, (_, index) => ({ index }))
    );
    title = "(1/2) Actions: Proof";
    listTitle = "(2/2) Actions: Proof";
    mocks.visible.mockReturnValue(Array.from({ length: 5 }, () => slot));
    mocks.write
        .mockRejectedValueOnce(new CycleFieldReadError("Holder", missing()))
        .mockResolvedValueOnce(undefined);
    await appendActionsToOpenActionList(ctx as never, [action], vi.fn() as never);
    expect(mocks.slotAt).toHaveBeenCalledWith(ctx, 25, 26, expect.anything());
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(slot.click.mock.calls.map((args) => args[0])).toEqual([undefined, undefined]);
});

for (const type of ["RANDOM", "CONDITIONAL"] as const) {
    test(`retains a new ${type} for a live replan without relying on its summary`, async () => {
        mocks.write
            .mockImplementationOnce(async () => {
                childList = true;
                editor = false;
                title = "Actions: New child";
                await apply();
            })
            .mockRejectedValueOnce(new CycleFieldReadError("Holder", missing()))
            .mockRejectedValue(missing());
        const parent =
            type === "RANDOM"
                ? { type, actions: [action] }
                : {
                      type,
                      conditions: [],
                      matchAny: false,
                      ifActions: [action],
                      elseActions: [],
                  };
        await expect(
            addAction(ctx as never, parent, vi.fn() as never, {} as never, 0)
        ).rejects.toThrow(`${missing().message}; Holder recovery exhausted`);
        expect(
            slot.click.mock.calls.filter((args) => args[0] === MouseButton.RIGHT)
        ).toHaveLength(1);
        expect(parentSlot.click).not.toHaveBeenCalled();
    });
}

test("an unconfirmed removal retains the original Holder diagnostic", async () => {
    mocks.write
        .mockRejectedValueOnce(new CycleFieldReadError("Holder", missing()))
        .mockRejectedValue(missing());
    mocks.visible.mockImplementation(() => [slot]);
    await expect(apply()).rejects.toThrow(
        `${missing().message}; Holder recovery exhausted; removal of the newly added Change Variable action was not confirmed.`
    );
});
