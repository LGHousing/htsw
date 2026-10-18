import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ back: vi.fn(), slotAt: vi.fn() }));
vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(async () => undefined),
    waitForMenu: vi.fn(async () => undefined),
}));
vi.mock("../src/housingSync/menus/menuUtils", async (original) => ({
    ...(await original<typeof import("../src/housingSync/menus/menuUtils")>()),
    clickGoBack: mocks.back,
}));
vi.mock("../src/housingSync/menus/paginatedList", async (original) => ({
    ...(await original<typeof import("../src/housingSync/menus/paginatedList")>()),
    getPaginatedListSlotAtIndex: mocks.slotAt,
}));
vi.mock("../src/tasks/specifics/slots", async (original) => ({
    ...(await original<typeof import("../src/tasks/specifics/slots")>()),
    menuStateDescription: () =>
        ' in "Action Settings" (slots: Head, Variable, Operation, Value, Automatic Unset)',
}));
import { withHolderRecovery } from "../src/housingSync/menus/holderRecovery";
import { HolderReadError, setCycleValue } from "../src/housingSync/menus/menuUtils";
import { MouseButton } from "../src/tasks/specifics/slots";
const diagnostic =
    'Could not find "Holder" in "Action Settings" (slots: Head, Variable, Operation, Value, Automatic Unset, Go Back, Note)';
const failure = () => new HolderReadError(diagnostic);
let title = "Action Settings";
let name = "Change Variable";
const slot = {
    getItem: () => ({ getName: () => name }),
    click: vi.fn(() => {
        title = "Action Settings";
    }),
};
const ctx = { getOpenContainerTitle: () => title };
const entry = {
    listTitle: "Actions: Proof",
    index: 25,
    listLength: 26,
    displayName: "Change Variable",
    editorTitle: "Action Settings",
    config: { label: "action", emptyPlaceholderName: "No Actions!" },
};
beforeEach(() => {
    vi.clearAllMocks();
    title = "Action Settings";
    name = "Change Variable";
    mocks.back.mockImplementation(async () => {
        title = "(2/2) Actions: Proof";
    });
    mocks.slotAt.mockResolvedValue(slot);
    slot.click.mockImplementation(() => {
        title = "Action Settings";
    });
});
for (const editorTitle of ["Action Settings", "Settings"]) {
    test(`reopens the same ${editorTitle} after a first-render or post-click Holder failure`, async () => {
        title = editorTitle;
        slot.click.mockImplementation(() => {
            title = editorTitle;
        });
        const write = vi
            .fn()
            .mockRejectedValueOnce(failure())
            .mockRejectedValueOnce(failure())
            .mockResolvedValue(undefined);
        await withHolderRecovery(ctx as never, { ...entry, editorTitle }, write);
        expect(write).toHaveBeenCalledTimes(3);
        expect(mocks.slotAt).toHaveBeenCalledWith(ctx, 25, 26, entry.config);
        expect(slot.click.mock.calls).toEqual([[], []]);
    });
}
test("exhaustion leaves the action intact and preserves the original diagnostic", async () => {
    const write = vi.fn().mockRejectedValue(failure());
    await expect(withHolderRecovery(ctx as never, entry, write)).rejects.toThrow(
        `${diagnostic}; Holder recovery exhausted after 3 reopens.`
    );
    expect(write).toHaveBeenCalledTimes(4);
    expect(slot.click.mock.calls).toEqual([[], [], []]);
    expect(title).toBe("Action Settings");
});
for (const change of ["list", "name"]) {
    test(`refuses a different ${change} without clicking and retains the diagnostic`, async () => {
        if (change === "list")
            mocks.back.mockImplementation(async () => {
                title = "Actions: Someone else";
            });
        else name = "Send a Chat Message";
        await expect(
            withHolderRecovery(ctx as never, entry, vi.fn().mockRejectedValue(failure()))
        ).rejects.toThrow(diagnostic);
        expect(slot.click).not.toHaveBeenCalled();
    });
}
test("other failures and enclosing writers are not retried", async () => {
    const error = new Error("unrelated field failure");
    await expect(
        withHolderRecovery(ctx as never, entry, vi.fn().mockRejectedValue(error))
    ).rejects.toBe(error);
    const holder = failure();
    await expect(
        withHolderRecovery(ctx as never, undefined, vi.fn().mockRejectedValue(holder))
    ).rejects.toBe(holder);
    expect(slot.click).not.toHaveBeenCalled();
});
for (const malformed of [
    null,
    { getItem: () => ({ getLore: () => [] }) },
    { getItem: () => ({ getLore: () => ["Player", "Global", "Team"] }) },
]) {
    test("never cycles a missing or malformed Holder, including the first render", async () => {
        await expect(
            setCycleValue(
                { tryGetMenuItemSlot: () => malformed } as never,
                "Holder",
                ["Player", "Global", "Team"],
                "Player"
            )
        ).rejects.toBeInstanceOf(HolderReadError);
    });
}
test.each(["Holder", "Variable Requirement"])(
    "cycles only the genuine %s and rereads it after the click",
    async (label) => {
        let selected = "Player";
        const cycle = {
            getItem: () => ({
                getLore: () => ["Player", "Global", "Team", `➠ ${selected}`],
            }),
            click: vi.fn(() => {
                selected = "Team";
            }),
        };
        await setCycleValue(
            {
                tryGetMenuItemSlot: (name: string) => name === label ? cycle : null,
            } as never,
            "Holder",
            ["Player", "Global", "Team"],
            "Team"
        );
        expect(cycle.click).toHaveBeenCalledExactlyOnceWith(MouseButton.RIGHT);
    }
);
