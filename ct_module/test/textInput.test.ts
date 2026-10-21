import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemSlot } from "../src/tasks/specifics/slots";
import type { WaitForPromise } from "../src/tasks/specifics/waitFor";
import TaskContext from "../src/tasks/context";

vi.mock("../src/utils/itemLore", () => ({
    itemLore: (item: { lore: string[] }) => item.lore,
}));
vi.mock("../src/housingSync/menus/menuWait", () => ({
    waitForMenu: vi.fn(),
    timedWaitForMenu: vi.fn(),
    waitForKnownMenu: vi.fn(),
}));

import { timedWaitForMenu, waitForMenu } from "../src/housingSync/menus/menuWait";
import {
    setListItemNote,
    setStringValue,
    setStringOrPaginatedOptionValue,
} from "../src/housingSync/menus/menuUtils";
import {
    housingTextRejection,
    submitHousingText,
} from "../src/housingSync/menus/textInput";
import { writeGiveExperienceLevels } from "../src/housingSync/actions/writers";
import { writeCompareVar } from "../src/housingSync/actions/conditions/writers";

import { chatMessage } from "../src/housingSync/menus/menuWaiters";
import { setTeamTag } from "../src/importables/teams/housing";

const BLOCKED = "§cThe stat key provided contains blocked words! (1)";

function inputContext(field = "Variable", before = "Kills") {
    const listeners = new Set<{
        event: string;
        check: (message: string) => boolean;
        resolve: (args: [string]) => void;
    }>();
    const ctx = Object.create(TaskContext.prototype) as TaskContext;
    ctx.beginChatPrompt = vi.fn();
    ctx.finishChatPrompt = vi.fn(async () => {});
    ctx.withTimeout = ((promise: WaitForPromise<unknown>) =>
        promise) as typeof ctx.withTimeout;
    ctx.waitFor = ((event: string, check: (message: string) => boolean) => {
        let listener: Parameters<typeof listeners.add>[0];
        const promise = new Promise<[string]>((resolve) => {
            listener = { event, check, resolve };
            listeners.add(listener);
        }) as WaitForPromise<[string]>;
        promise.cleanupWaiter = () => listeners.delete(listener);
        return promise;
    }) as typeof ctx.waitFor;
    const receive = (message: string, event = "message") => {
        for (const listener of [...listeners]) {
            if (listener.event === event && listener.check(message)) {
                listeners.delete(listener);
                listener.resolve([message]);
            }
        }
    };
    const slot = (value: string) =>
        ({
            getItem: () => ({
                getName: () => field,
                lore: ["Current Value:", `§7${value}`, "", "Click to edit!"],
            }),
            click: () =>
                queueMicrotask(() =>
                    receive("Please use the chat to provide the value you wish to set.")
                ),
        }) as unknown as ItemSlot;
    let actual = before;
    ctx.tryGetMenuItemSlot = vi.fn(() => slot(actual));
    ctx.getMenuItemSlot = vi.fn(() => slot(before));
    let openMenu!: () => void;
    const menuCleanup = vi.fn();
    vi.mocked(waitForMenu).mockImplementation(() => {
        const promise = new Promise<void>((resolve) => {
            openMenu = resolve;
        }) as WaitForPromise<void>;
        promise.cleanupWaiter = menuCleanup;
        return promise;
    });
    vi.mocked(timedWaitForMenu).mockImplementation(() => waitForMenu(ctx));
    ctx.sendMessage = vi.fn(async (_value: string, onSent?: () => void) => {
        onSent?.();
        openMenu();
    });
    return {
        ctx,
        slot: slot(before),
        receive,
        listeners,
        menuCleanup,
        openMenu: () => openMenu(),
        setActual: (value: string) => {
            actual = value;
        },
    };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("Housing text inputs", () => {
    it.each([setStringValue, setStringOrPaginatedOptionValue])(
        "fails a blocked variable write when read-back still shows Kills (%s)",
        async (write) => {
            const { ctx, slot, receive, openMenu, listeners, menuCleanup } =
                inputContext();
            const sendMessage = vi.fn(async (_value: string, onSent?: () => void) => {
                onSent?.();
                receive(BLOCKED);
                openMenu();
            });
            ctx.sendMessage = sendMessage;
            await expect(write(ctx, slot, "n19")).rejects.toThrow(
                'HTSW_INPUT_REJECTED: Hypixel\'s chat filter rejected "n19" for Variable; rename it'
            );
            expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
                "n19",
                expect.any(Function)
            );
            expect(listeners.size).toBe(0);
            expect(menuCleanup).toHaveBeenCalled();
        }
    );

    it.each(["&cRED", "§cRED"])(
        "accepts a correctly applied formatted team tag %s",
        async (tag) => {
            const { ctx, slot } = inputContext();
            const tagSlot = (current: string) =>
                ({
                    getItem: () => ({ lore: [`Current Tag: [${current}]`] }),
                    click: () => slot.click(),
                }) as unknown as ItemSlot;
            ctx.getMenuItemSlot = () => tagSlot("GUEST");
            ctx.tryGetMenuItemSlot = () => tagSlot("§cRED");
            await expect(setTeamTag(ctx, tag)).resolves.toBeUndefined();
        }
    );

    it("still fails when Housing retains the wrong team tag", async () => {
        const { ctx, slot } = inputContext();
        const tagSlot = {
            getItem: () => ({ lore: ["Current Tag: [GUEST]"] }),
            click: () => slot.click(),
        } as unknown as ItemSlot;
        ctx.getMenuItemSlot = () => tagSlot;
        ctx.tryGetMenuItemSlot = () => tagSlot;
        await expect(setTeamTag(ctx, "&cRED")).rejects.toThrow("HTSW_INPUT_REJECTED:");
    });

    it.each([setStringValue, setStringOrPaginatedOptionValue])(
        "accepts formatted display names through the shared string reader (%s)",
        async (write) => {
            const { ctx, slot, setActual } = inputContext("Item Name", "Old");
            setActual("§cRED");
            await expect(write(ctx, slot, "&cRED")).resolves.toBeUndefined();
        }
    );

    it.each([
        "Created custom menu with the title &cRED!",
        "Created region &cRED!",
        "Renamed function Old to &cRED",
        "Renamed region Old to &cRED",
    ])("accepts confirmations containing formatted names: %s", async (message) => {
        const { ctx, receive, listeners } = inputContext();
        const confirmation = chatMessage(message).start(ctx);
        receive(message.replace("&cRED", "§cBLUE"));
        expect(listeners.size).toBe(1);
        receive(message.replace("&cRED", "§cRED"));
        await expect(confirmation).resolves.toBeUndefined();
    });

    it("fails a read-back mismatch without a rejection reply", async () => {
        const { ctx, slot } = inputContext();
        await expect(setStringValue(ctx, slot, "n19")).rejects.toThrow(
            'HTSW_INPUT_REJECTED: Housing did not apply Variable: expected "n19", read "Kills"'
        );
    });

    it.each(["This route is not valid!", BLOCKED])(
        "accepts a matching read-back despite unrelated chat: %s",
        async (message) => {
            const { ctx, slot, setActual, receive, openMenu } = inputContext();
            ctx.sendMessage = async (_value, onSent) => {
                onSent?.();
                receive(message);
                setActual("coins");
                openMenu();
            };
            await expect(setStringValue(ctx, slot, "coins")).resolves.toBeUndefined();
        }
    );

    it.each([
        ["1234567", "1,234,567"],
        ["3.14159265", "3.142"],
    ])(
        "accepts numeric action and condition writes displayed as %s → %s",
        async (expected, actual) => {
            const action = inputContext("Levels", "0");
            action.setActual(actual);
            await expect(
                writeGiveExperienceLevels(action.ctx, {
                    type: "GIVE_EXPERIENCE_LEVELS",
                    amount: expected,
                })
            ).resolves.toBeUndefined();
            const condition = inputContext("Compare Value", "0");
            condition.setActual(actual);
            const getSlot = condition.ctx.getMenuItemSlot.bind(condition.ctx);
            condition.ctx.getMenuItemSlot = (name) =>
                name === "Fallback Value"
                    ? ({
                          getItem: () => ({ lore: ["Current Value:", "Not Set"] }),
                      } as unknown as ItemSlot)
                    : getSlot(name);
            await expect(
                writeCompareVar(condition.ctx, {
                    type: "COMPARE_VAR",
                    amount: expected,
                    fallback: "Not Set",
                })
            ).resolves.toBeUndefined();
        }
    );

    it.each([true, false])(
        "checks visible note text after writing (accepted=%s)",
        async (accepted) => {
            const { ctx, receive } = inputContext();
            const noteSlot = (note: string) =>
                ({
                    getSlotId: () => 10,
                    getItem: () => ({ lore: ["Action", "Click to edit!", "", note] }),
                    drop: () =>
                        queueMicrotask(() =>
                            receive(
                                "Please use the chat to provide the value you wish to set."
                            )
                        ),
                }) as unknown as ItemSlot;
            ctx.getMenuItemSlots = () => [noteSlot(accepted ? "§cHello" : "Old")];
            const result = setListItemNote(ctx, noteSlot("Old"), "&cHello");
            if (accepted) await expect(result).resolves.toBeUndefined();
            else await expect(result).rejects.toThrow("HTSW_INPUT_REJECTED:");
        }
    );

    it("keeps numeric-looking variable names strict", async () => {
        const { ctx, slot, setActual } = inputContext();
        setActual("1,234,567");
        await expect(setStringValue(ctx, slot, "1234567")).rejects.toThrow(
            "HTSW_INPUT_REJECTED:"
        );
    });

    it("does not listen during sender cooldown", async () => {
        const { ctx, receive, openMenu, listeners } = inputContext();
        await expect(
            submitHousingText(
                ctx,
                "Variable",
                "n19",
                async (onSent) => {
                    receive(BLOCKED); // A previous write's late reply, before this send.
                    await Promise.resolve();
                    onSent();
                    openMenu();
                },
                () => waitForMenu(ctx)
            )
        ).resolves.toBeUndefined();
        expect(listeners.size).toBe(0);
    });

    it("uses an exact reply for an unreadable field only within the short send window", async () => {
        const { ctx, receive, listeners, menuCleanup } = inputContext();
        const result = submitHousingText(
            ctx,
            "Variable",
            "n19",
            (onSent) => onSent(),
            () => waitForMenu(ctx)
        );
        await Promise.resolve();
        receive(BLOCKED);
        await expect(result).rejects.toThrow(
            'HTSW_INPUT_REJECTED: Hypixel\'s chat filter rejected "n19"'
        );
        expect(listeners.size).toBe(0);
        expect(menuCleanup).toHaveBeenCalled();
    });

    it("ignores replies after the short window and removes the listener", async () => {
        let now = 0;
        vi.spyOn(Date, "now").mockImplementation(() => now);
        const { ctx, receive, openMenu, listeners } = inputContext();
        const result = submitHousingText(
            ctx,
            "Variable",
            "n19",
            (onSent) => onSent(),
            () => waitForMenu(ctx)
        );
        now = 1501;
        receive(BLOCKED);
        receive("", "tick");
        await Promise.resolve();
        expect(
            [...listeners].filter((listener) => listener.event === "message")
        ).toHaveLength(0);
        openMenu();
        await expect(result).resolves.toBeUndefined();
        expect(listeners.size).toBe(0);
    });

    it("notifies listeners only after the raw chat send", async () => {
        const ctx = new TaskContext();
        const events: string[] = [];
        vi.spyOn(ctx, "sleep").mockResolvedValue();
        vi.spyOn(
            ctx as unknown as { sendRawChatPacket(message: string): void },
            "sendRawChatPacket"
        ).mockImplementation(() => {
            events.push("wire");
        });
        await ctx.runCommand("/command create tpa", () => {
            events.push("command listener");
        });
        await ctx.sendMessage("coins", () => {
            events.push("value listener");
        });
        expect(events).toEqual(["wire", "command listener", "wire", "value listener"]);
    });

    it("recognizes only observed replies for the corresponding input", () => {
        expect(
            housingTextRejection("This command is not valid!", "Command name")
        ).not.toBeNull();
        expect(
            housingTextRejection("This command already exists!", "Variable")
        ).toBeNull();
        expect(housingTextRejection("This route is not valid!", "Variable")).toBeNull();
        expect(
            housingTextRejection("The name can only contain letters!", "Variable")
        ).toBeNull();
        expect(
            housingTextRejection(
                "Player: The stat key provided contains blocked words! (1)",
                "Variable"
            )
        ).toBeNull();
    });
});
