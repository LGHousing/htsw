import type { Color } from "htsw/types";

import { clickGoBack, openSubmenu } from "../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../housingSync/menus/menuWait";
import type TaskContext from "../tasks/context";
import { ItemSlot, menuStateDescription } from "../tasks/specifics/slots";
import { plainItemName, removedFormatting } from "../utils/helpers";
import { itemLore } from "../utils/itemLore";

// Housing lays out the team and group editors alike; these read and set the
// fields they share.

export const CHANGE_TAG_SLOT = "Change Tag";
export const CHANGE_COLOR_SLOT = "Change Color";

const CURRENT_TAG_LABEL = "Current Tag:";
const CURRENT_COLOR_LABEL = "Current Color:";

const COLOR_BY_CODE: Partial<Record<string, Color>> = {
    "1": "Dark Blue",
    "2": "Dark Green",
    "3": "Dark Aqua",
    "4": "Dark Red",
    "5": "Dark Purple",
    "6": "Gold",
    "7": "Gray",
    "8": "Dark Gray",
    "9": "Blue",
    a: "Green",
    b: "Aqua",
    c: "Red",
    d: "Light Purple",
    e: "Yellow",
};

export function teamGroupColorFromDisplayName(displayName: string): Color | undefined {
    for (let i = 0; i < displayName.length - 1; i++) {
        if (displayName.charAt(i) !== "§") continue;
        const color = COLOR_BY_CODE[displayName.charAt(i + 1).toLowerCase()];
        if (color !== undefined) return color;
    }
    return undefined;
}

// Housing renders a field as a single "Label: value" lore line ("Current Tag:
// [GUEST]", "Current Color: Gray", "Current Value: Disabled"); some toggles put
// the value on the following line instead.
export function readLabeledLoreValue(slot: ItemSlot, label: string): string | null {
    const lore = itemLore(slot.getItem());
    for (let i = 0; i < lore.length; i++) {
        const line = removedFormatting(lore[i]).trim();
        if (line.indexOf(label) !== 0) continue;
        const inline = line.substring(label.length).trim();
        if (inline.length > 0) return inline;
        if (i + 1 < lore.length) {
            const next = removedFormatting(lore[i + 1]).trim();
            if (next.length > 0) return next;
        }
        return null;
    }
    return null;
}

export function readEnabledDisabled(value: string | null): boolean | null {
    if (value === "Enabled") return true;
    if (value === "Disabled") return false;
    return null;
}

// Housing displays a tag wrapped in brackets ("Current Tag: [GUEST]") but
// stores and accepts the bare value; strip the wrapper for the canonical tag.
export function readTagValue(slot: ItemSlot): string | null {
    const raw = readLabeledLoreValue(slot, CURRENT_TAG_LABEL);
    if (raw === null) return null;
    if (raw.length >= 2 && raw.charAt(0) === "[" && raw.charAt(raw.length - 1) === "]") {
        return raw.substring(1, raw.length - 1);
    }
    return raw;
}

export function readColorValue(slot: ItemSlot): string | null {
    return readLabeledLoreValue(slot, CURRENT_COLOR_LABEL);
}

export async function pickColor(
    ctx: TaskContext,
    color: Color,
    owner: "team" | "group"
): Promise<void> {
    if (readColorValue(ctx.getMenuItemSlot(CHANGE_COLOR_SLOT)) === color) return;

    await openSubmenu(ctx, CHANGE_COLOR_SLOT);
    const optionSlot = ctx.tryGetMenuItemSlot(
        (slot) => plainItemName(slot.getItem().getName()) === color
    );
    if (optionSlot === null) {
        throw new Error(
            `Could not find color "${color}" in the ${owner} color picker${menuStateDescription()}`
        );
    }
    optionSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    // The picker returns to the manage menu on selection; if it doesn't, unwind.
    if (ctx.tryGetMenuItemSlot(CHANGE_COLOR_SLOT) === null) {
        await clickGoBack(ctx);
    }
}
