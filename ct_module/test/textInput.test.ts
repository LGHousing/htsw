import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { waitForMenu } from "../src/housingSync/menus/menuWait";
import {
    setStringValue,
    setStringOrPaginatedOptionValue,
} from "../src/housingSync/menus/menuUtils";
import {
    housingTextRejection,
    submitHousingText,
} from "../src/housingSync/menus/textInput";

function inputContext() {
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
    const receive = (message: string) => {
        for (const listener of [...listeners]) {
            if (listener.event === "message" && listener.check(message)) {
                listeners.delete(listener);
                listener.resolve([message]);
            }
        }
    };
    const slot = (value: string) =>
        ({
            getItem: () => ({
                getName: () => "§aVariable",
                lore: ["Current Value:", `§7${value}`, "", "Click to edit!"],
            }),
            click: () =>
                queueMicrotask(() =>
                    receive("Please use the chat to provide the value you wish to set.")
                ),
        }) as unknown as ItemSlot;
    let actual = "Kills";
    ctx.tryGetMenuItemSlot = vi.fn(() => slot(actual));
    let openMenu!: () => void;
    const menuCleanup = vi.fn();
    vi.mocked(waitForMenu).mockImplementation(() => {
        const promise = new Promise<void>((resolve) => {
            openMenu = resolve;
        }) as WaitForPromise<void>;
        promise.cleanupWaiter = menuCleanup;
        return promise;
    });
    ctx.sendMessage = vi.fn(async () => {
        openMenu();
    });
    return {
        ctx,
        slot: slot("Kills"),
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

describe("Housing text inputs", () => {
    it.each([setStringValue, setStringOrPaginatedOptionValue])(
        "fails a variable write when the blocked-words reply arrives during send (%s)",
        async (write) => {
            const { ctx, slot, receive, openMenu, listeners, menuCleanup } =
                inputContext();
            const sendMessage = vi.fn(async () => {
                receive("§cThe stat key provided contains blocked words! (1)");
                openMenu(); // Housing returns the editor with its old default.
            });
            ctx.sendMessage = sendMessage;
            await expect(write(ctx, slot, "n19")).rejects.toThrow(
                'Hypixel\'s chat filter rejected "n19" for Variable; rename it'
            );
            expect(sendMessage).toHaveBeenCalledExactlyOnceWith("n19");
            expect(listeners.size).toBe(0);
            expect(menuCleanup).toHaveBeenCalled();
        }
    );

    it("fails when the returned field still reads Kills without a rejection reply", async () => {
        const { ctx, slot } = inputContext();
        await expect(setStringValue(ctx, slot, "n19")).rejects.toThrow(
            'Housing did not apply Variable: expected "n19", read "Kills"'
        );
    });

    it("accepts a write whose fresh field matches", async () => {
        const { ctx, slot, setActual } = inputContext();
        setActual("coins");
        await expect(setStringValue(ctx, slot, "coins")).resolves.toBeUndefined();
    });

    it("keeps listening after send until confirmation, and cleans up on rejection", async () => {
        const { ctx, receive, listeners, menuCleanup } = inputContext();
        const result = submitHousingText(
            ctx,
            "Item name",
            "n19",
            () => {},
            () => waitForMenu(ctx)
        );
        await Promise.resolve();
        receive("The item name contains blocked words!");
        await expect(result).rejects.toThrow('rejected "n19" for Item name');
        expect(listeners.size).toBe(0);
        expect(menuCleanup).toHaveBeenCalled();
    });

    it("recognizes server refusals without matching player chat", () => {
        expect(
            housingTextRejection("This command is not valid! A server-supplied reason.")
        ).not.toBeNull();
        expect(housingTextRejection("This command already exists!")).not.toBeNull();
        expect(housingTextRejection("The name can only contain letters!")).not.toBeNull();
        expect(
            housingTextRejection(
                "Player: The stat key provided contains blocked words! (1)"
            )
        ).toBeNull();
    });
});
