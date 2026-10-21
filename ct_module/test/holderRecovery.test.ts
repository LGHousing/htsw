import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ back: vi.fn() }));
vi.mock("@htsw/importer/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(async () => undefined),
    waitForMenu: vi.fn(async () => undefined),
}));
vi.mock("@htsw/importer/housingSync/menus/menuUtils", async (original) => ({
    ...(await original<typeof import("@htsw/importer/housingSync/menus/menuUtils")>()),
    clickGoBack: mocks.back,
}));
vi.mock("../src/tasks/specifics/slots", async (original) => ({
    ...(await original<typeof import("../src/tasks/specifics/slots")>()),
    menuStateDescription: () =>
        ' in "Action Settings" (slots: Head, Variable, Operation, Value, Automatic Unset)',
}));
import { withHolderRecovery } from "@htsw/importer/housingSync/menus/holderRecovery";
import { HolderReadError, setCycleValue } from "@htsw/importer/housingSync/menus/menuUtils";
import { MouseButton } from "../src/tasks/specifics/slots";
const diagnostic =
    'Could not find "Holder" in "Action Settings" (slots: Head, Variable, Operation, Value, Automatic Unset, Go Back, Note)';
const failure = () => new HolderReadError(diagnostic);
let title = "Action Settings";
let name = "Change Variable";
let length = 26;
let page = 2;
let listTitle = "Actions: Proof";
const showList = (targetPage = 2) => {
    page = targetPage;
    title = `(${page}/${Math.ceil(length / 21)}) ${listTitle}`;
};
const slot = {
    getSlotId: () => 14,
    getItem: () => ({ getName: () => name }),
    click: vi.fn(() => {
        title = "Action Settings";
    }),
};
const pageSlot = (id: number, target: number) => ({
    getSlotId: () => id,
    click: () => showList(target),
});
const ctx = {
    getOpenContainerTitle: () => title,
    getAllItemSlots: () =>
        Array.from(
            { length: Math.max(0, Math.min(21, length - (page - 1) * 21)) },
            (_, localIndex) =>
                (page - 1) * 21 + localIndex === entry.index
                    ? slot
                    : {
                          getSlotId: () =>
                              10 + Math.floor(localIndex / 7) * 9 + (localIndex % 7),
                          getItem: () => ({ getName: () => "Send a Chat Message" }),
                          click: vi.fn(() => {
                              throw new Error("Clicked the wrong entry");
                          }),
                      }
        ),
    tryGetItemSlot: (matches: (slot: { getSlotId: () => number }) => boolean) => {
        if (page < Math.ceil(length / 21) && matches(pageSlot(53, page + 1)))
            return pageSlot(53, page + 1);
        if (page > 1 && matches(pageSlot(45, page - 1))) return pageSlot(45, page - 1);
        return null;
    },
    getItemSlot: (matches: (slot: { getSlotId: () => number }) => boolean) => {
        const result = ctx.tryGetItemSlot(matches);
        if (result === null) throw new Error("Missing page arrow");
        return result;
    },
};
const reopenList = vi.fn(async () => {
    showList(1);
});
const entry = {
    listTitle: "Actions: Proof",
    reopenList,
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
    length = 26;
    page = 2;
    listTitle = "Actions: Proof";
    mocks.back.mockImplementation(async () => {
        showList();
    });
    reopenList.mockImplementation(async () => {
        showList(1);
    });
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
        expect(reopenList).not.toHaveBeenCalled();
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
                tryGetMenuItemSlot: (name: string) => (name === label ? cycle : null),
            } as never,
            "Holder",
            ["Player", "Global", "Team"],
            "Team"
        );
        expect(cycle.click).toHaveBeenCalledExactlyOnceWith(MouseButton.RIGHT);
    }
);

for (const condition of [false, true])
    for (const malformed of condition
        ? ["Head", "Change Player's Group", "Change Variable"]
        : ["Head", "Change Player's Group"]) {
        test(`refreshes a ${malformed} parent before reopening the ${condition ? "condition" : "action"} editor`, async () => {
            const editorTitle = condition ? "Settings" : "Action Settings";
            const displayName = condition ? "Variable Requirement" : "Change Variable";
            title = editorTitle;
            listTitle = condition ? "Edit Conditions" : "Actions: Proof";
            name = malformed;
            reopenList.mockImplementation(async () => {
                expect(slot.click).not.toHaveBeenCalled();
                showList(1);
                name = displayName;
            });
            slot.click.mockImplementation(() => {
                title = editorTitle;
            });
            const write = vi
                .fn()
                .mockRejectedValueOnce(failure())
                .mockResolvedValue(undefined);
            await withHolderRecovery(
                ctx as never,
                {
                    ...entry,
                    listTitle,
                    editorTitle,
                    displayName,
                    config: condition
                        ? { label: "condition", emptyPlaceholderName: "No Conditions!" }
                        : entry.config,
                },
                write
            );
            expect(reopenList).toHaveBeenCalledTimes(1);
            expect(slot.click).toHaveBeenCalledTimes(1);
            expect(write).toHaveBeenCalledTimes(2);
        });
    }

test.each(["Head", "Change Player's Group"])(
    "refuses a persistent %s parent after two refreshes without clicking it",
    async (malformed) => {
        name = malformed;
        await expect(
            withHolderRecovery(ctx as never, entry, vi.fn().mockRejectedValue(failure()))
        ).rejects.toThrow(
            `held "${malformed}" at index 25 (length 26); expected "Change Variable" after 2 parent list reopens.`
        );
        expect(reopenList).toHaveBeenCalledTimes(2);
        expect(slot.click).not.toHaveBeenCalled();
    }
);

test.each(["Head", "Change Player's Group"])(
    "refuses a changed list length after refreshing %s",
    async (malformed) => {
        name = malformed;
        reopenList.mockImplementation(async () => {
            length = 27;
            name = entry.displayName;
            showList(1);
        });
        await expect(
            withHolderRecovery(ctx as never, entry, vi.fn().mockRejectedValue(failure()))
        ).rejects.toThrow("length changed: expected 26, found 27 (index 25)");
        expect(slot.click).not.toHaveBeenCalled();
        expect(reopenList).toHaveBeenCalledTimes(1);
    }
);

test("rechecks the parent title after refreshing", async () => {
    name = "Head";
    reopenList.mockImplementation(async () => {
        title = "Actions: Someone else";
    });
    await expect(
        withHolderRecovery(ctx as never, entry, vi.fn().mockRejectedValue(failure()))
    ).rejects.toThrow('returned to "Actions: Someone else"');
    expect(slot.click).not.toHaveBeenCalled();
});

test("refuses an unknown parent when no owning navigation was supplied", async () => {
    name = "Head";
    await expect(
        withHolderRecovery(
            ctx as never,
            { ...entry, reopenList: undefined },
            vi.fn().mockRejectedValue(failure())
        )
    ).rejects.toThrow('held "Head"');
    expect(slot.click).not.toHaveBeenCalled();
    expect(reopenList).not.toHaveBeenCalled();
});

test("does not refresh an arbitrary unknown parent name", async () => {
    name = "Unrecognized item";
    await expect(
        withHolderRecovery(ctx as never, entry, vi.fn().mockRejectedValue(failure()))
    ).rejects.toThrow('held "Unrecognized item"');
    expect(reopenList).not.toHaveBeenCalled();
    expect(slot.click).not.toHaveBeenCalled();
});

test("refuses a changed list length before refreshing", async () => {
    length = 27;
    await expect(
        withHolderRecovery(ctx as never, entry, vi.fn().mockRejectedValue(failure()))
    ).rejects.toThrow("length changed: expected 26, found 27 (index 25)");
    expect(slot.click).not.toHaveBeenCalled();
    expect(reopenList).not.toHaveBeenCalled();
});

test("a failed Holder recovery retains the incomplete-read prefix and original context", async () => {
    const { IncompleteReadError } = await import("@htsw/importer/housingSync/incompleteRead");
    const incomplete = new IncompleteReadError("Parent action list not ready");
    mocks.back.mockRejectedValueOnce(incomplete);
    await expect(
        withHolderRecovery(ctx as never, entry, vi.fn().mockRejectedValue(failure()))
    ).rejects.toBe(incomplete);
    expect(incomplete.message).toBe(
        `HTSW_INCOMPLETE_READ: Parent action list not ready (Holder recovery after ${diagnostic})`
    );
});
