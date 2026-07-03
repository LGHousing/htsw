import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import TaskContext from "../../tasks/context";
import { MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting, unique } from "../../utils/helpers";
import { oneOf } from "../../tasks/waiters";
import { chatMessage } from "../../housingSync/menus/menuWaiters";
import { menuCreated, menuSettingsOpened } from "../waiters";
import { getSessionMenuNamesLower, noteMenuCreated } from "./listMenus";

export async function openMenuEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    const result = await ctx.expectAfter(
        () => ctx.runCommand(`/menu edit ${name}`),
        oneOf({
            opened: menuSettingsOpened(name),
            missing: chatMessage("Could not find a custom menu with that title!"),
        })
    );

    return result;
}

/**
 * From the "Edit Menu: <name>" settings screen (where `/menu edit` lands),
 * enter the actual slot grid by left-clicking "Edit Menu Elements". The
 * settings screen holds Change Title / Change Size / Edit Menu Elements; the
 * menu's real slots live one level deeper, behind this button. Read settings
 * (size) BEFORE calling this, then operate on slots after.
 */
export async function openMenuElements(ctx: TaskContext): Promise<void> {
    const slot = ctx.tryGetItemSlot(
        (s) =>
            removedFormatting(s.getItem().getName()).indexOf("Edit Menu Elements") >= 0
    );
    if (slot === null) {
        throw new Error(
            'Could not find the "Edit Menu Elements" button on the menu settings screen.'
        );
    }
    // LEFT click: right-click opens the free-form move editor (wrong mode).
    slot.click(MouseButton.LEFT);
    await timedWaitForMenu(ctx, "menuClickWait");
}

/**
 * Set the menu's size (rows, 1..6) from the "Edit Menu: <name>" settings
 * screen. The "Change Menu Size" button opens a picker sub-menu of beacons
 * each named "<N> Rows"; clicking the target beacon selects it and returns to
 * the settings screen. Caller must be on the settings screen; leaves it there.
 */
export async function setMenuSize(ctx: TaskContext, rows: number): Promise<void> {
    const sizeButton = ctx.getItemSlot(
        (s) =>
            removedFormatting(s.getItem().getName()).indexOf("Change Menu Size") >= 0
    );
    sizeButton.click(MouseButton.LEFT);
    await timedWaitForMenu(ctx, "menuClickWait");

    const target = ctx.getItemSlot((s) => {
        const name = removedFormatting(s.getItem().getName())
            .replace(/\s*\(#[^)]*\)\s*$/, "")
            .trim();
        return name === `${rows} Rows` || name === `${rows} Row`;
    });
    target.click(MouseButton.LEFT);
    await timedWaitForMenu(ctx, "menuClickWait");
}

export async function ensureMenuNamesExist(
    ctx: TaskContext,
    menuNames: readonly string[],
    onEach?: (name: string) => void
): Promise<void> {
    const names = unique(menuNames);
    if (names.length === 0) return;

    const existing = await getSessionMenuNamesLower(ctx);

    for (const name of names) {
        if (!existing.has(name.toLowerCase())) {
            await ctx.expectAfter(
                () => ctx.runCommand(`/menu create ${name}`),
                menuCreated(name)
            );
            await clickGoBack(ctx);
            noteMenuCreated(name);
        }
        onEach?.(name);
    }
}
