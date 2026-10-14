import { describe, expect, test, vi } from "vitest";

import { setCycleValue } from "../src/housingSync/menus/menuUtils";
import type TaskContext from "../src/tasks/context";
import { ItemSlot, MouseButton } from "../src/tasks/specifics/slots";

vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(async () => undefined),
}));

const holders = ["Player", "Global", "Team"];

function holderMenu(name: string, selected: string, options = holders) {
    const slot = new ItemSlot(10, {
        getName: () => `§a${name}`,
        getLore: () => [
            "§7Options:",
            ...options.map((option) =>
                option === selected ? `§a➜ ${option}` : `§7${option}`
            ),
        ],
    } as Item);
    const click = vi.spyOn(slot, "click").mockImplementation((button) => {
        const direction = button === MouseButton.RIGHT ? -1 : 1;
        selected =
            holders[
                (holders.indexOf(selected) + direction + holders.length) % holders.length
            ];
    });
    const ctx = {
        tryGetMenuItemSlot: (check: string | ((slot: ItemSlot) => boolean)) =>
            (typeof check === "string" ? check === name : check(slot)) ? slot : null,
        getMenuItemSlot: () => {
            throw new Error('Could not find "Holder"');
        },
    } as unknown as TaskContext;
    return { ctx, click, selected: () => selected };
}

describe("Holder cycle lookup", () => {
    test.each(["Holder", "Change Variable", "Head", "Variable Requirement"])(
        "%s accepts an already selected Player",
        async (name) => {
            const menu = holderMenu(name, "Player");
            await setCycleValue(menu.ctx, "Holder", holders, "Player");
            expect(menu.click).not.toHaveBeenCalled();
        }
    );

    test.each(["Global", "Team"])("switches %s back to Player", async (selected) => {
        const menu = holderMenu("Variable Requirement", selected);
        await setCycleValue(menu.ctx, "Holder", holders, "Player");
        expect(menu.selected()).toBe("Player");
        expect(menu.click).toHaveBeenCalledTimes(1);
    });

    test.each(holders)(
        "rejects Variable Requirement lore missing %s",
        async (missing) => {
            const menu = holderMenu(
                "Variable Requirement",
                "Player",
                holders.filter((option) => option !== missing)
            );
            await expect(
                setCycleValue(menu.ctx, "Holder", holders, "Player")
            ).rejects.toThrow('Could not find "Holder"');
            expect(menu.click).not.toHaveBeenCalled();
        }
    );

    test("rejects unrelated icons with the same options", async () => {
        const menu = holderMenu("Other Field", "Player");
        await expect(
            setCycleValue(menu.ctx, "Holder", holders, "Player")
        ).rejects.toThrow('Could not find "Holder"');
    });
});
