import { clickGoBack } from "../../housingSync/gui/menuUtils";
import {
    timedWaitForMenu,
    timedWaitForUnformattedMessage,
} from "../../housingSync/gui/menuWait";
import TaskContext from "../../tasks/context";
import { MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting, unique } from "../../utils/helpers";

export async function openMenuEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    await ctx.runCommand(`/menu edit ${name}`);

    const menuWait = timedWaitForMenu(ctx, "commandMenuWait");
    const msgWait = ctx.waitFor(
        "message",
        (message) =>
            removedFormatting(message) ===
            "Could not find a menu with that name!"
    );
    const opened = await ctx.withTimeout(
        ctx.race<boolean>([
            [menuWait.then(() => true), menuWait],
            [msgWait.then(() => false), msgWait],
        ]),
        "Waiting for menu to open"
    );

    return opened ? "opened" : "missing";
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

    for (const name of names) {
        const status = await openMenuEditor(ctx, name);
        if (status === "opened") {
            await clickGoBack(ctx);
            onEach?.(name);
            continue;
        }

        await ctx.runCommand(`/menu create ${name}`);
        await timedWaitForUnformattedMessage(ctx, `Created menu ${name}!`);
        onEach?.(name);
    }
}
