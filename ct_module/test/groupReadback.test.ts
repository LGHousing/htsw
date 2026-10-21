import { describe, expect, it, vi } from "vitest";
import type TaskContext from "../src/tasks/context";
import type { ItemSlot } from "../src/tasks/specifics/slots";

vi.mock("../src/utils/itemLore", () => ({
    itemLore: (item: { lore: string[] }) => item.lore,
}));
vi.mock("../src/housingSync/menus/menuUtils", () => ({
    enterValue: async () => undefined,
    openSubmenu: async () => undefined,
    clickGoBack: async () => undefined,
    forEachPaginatedPage: async (_ctx: unknown, read: () => unknown) => read(),
}));
vi.mock("../src/housingSync/menus/menuWait", () => ({
    waitForMenu: async () => undefined,
    timedWaitForMenu: async () => undefined,
}));

import {
    setGroupTag,
    setGroupPriority,
    setGroupTagShownInChat,
    applyGroupPermissionMenu,
} from "../src/importables/groups/housing";

function context(lore: string[], after?: string[]) {
    const slot = {
        getItem: () => ({ lore }),
        click: () => {
            if (after !== undefined) lore = after;
        },
    } as unknown as ItemSlot;
    return {
        getMenuItemSlot: () => slot,
        tryGetMenuItemSlot: () => slot,
    } as unknown as TaskContext;
}

describe("group write read-back", () => {
    it("fails visibly when Housing refuses a tag and keeps the old value", async () => {
        await expect(
            setGroupTag(context(["Current Tag: [GUEST]"]), "HELPER")
        ).rejects.toThrow(
            'Housing did not apply group tag: expected "HELPER", read "GUEST"'
        );
    });

    it.each(["TEST", "&cTEST", "§cTEST"])("accepts a tag that reads back correctly: %s", async (tag) => {
        await expect(
            setGroupTag(
                context(["Current Tag: [GUEST]"], ["Current Tag: [§cTEST]"]),
                tag
            )
        ).resolves.toBeUndefined();
    });

    it("checks priority and tag visibility rather than assuming clicks succeeded", async () => {
        await expect(
            setGroupPriority(context(["Current Priority: 1"]), 2)
        ).rejects.toThrow("Housing did not apply group priority");
        await expect(
            setGroupTagShownInChat(context(["Tag Shows in Chat: Disabled"]), true)
        ).rejects.toThrow("Housing did not apply group tagShownInChat");
    });

    it("fails when a requested permission is missing from the menu", async () => {
        const ctx = {
            tryGetMenuItemSlot: () => null,
            getMenuItemSlots: () => [],
        } as unknown as TaskContext;
        await expect(applyGroupPermissionMenu(ctx, { Fly: true }, undefined, undefined))
            .rejects.toThrow('Housing did not apply group permission "Fly"');
    });
});
