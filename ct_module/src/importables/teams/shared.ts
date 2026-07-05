import type { Color } from "htsw/types";

import {
    clickGoBack,
    enterValue,
    openSubmenu,
} from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu, waitForMenu } from "../../housingSync/menus/menuWait";
import TaskContext from "../../tasks/context";
import { ItemSlot, menuStateDescription } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { openTeamsList } from "./listTeams";

const CHANGE_TAG_SLOT = "Change Tag";
const CHANGE_COLOR_SLOT = "Change Color";
const FRIENDLY_FIRE_SLOT = "Friendly Fire";

const CURRENT_TAG_LABEL = "Current Tag:";
const CURRENT_COLOR_LABEL = "Current Color:";
const CURRENT_VALUE_LABEL = "Current Value:";

export type TeamSettings = {
    tag: string | null;
    color: string | null;
    friendlyFire: boolean | null;
};

function stripTooltipDebugSuffix(name: string): string {
    return name.replace(/\s*\(#[0-9a-fA-F]+(?:\/[0-9]+)?\)\s*$/, "").trim();
}

// Housing renders team fields as a single "Label: value" lore line
// ("Current Tag: [x]", "Current Color: White", "Current Value: Disabled");
// some toggles put the value on the following line instead.
function readLabeledLoreValue(slot: ItemSlot, label: string): string | null {
    const lore = slot.getItem().getLore();
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

function readFriendlyFireValue(slot: ItemSlot): boolean | null {
    const value = readLabeledLoreValue(slot, CURRENT_VALUE_LABEL);
    if (value === null) return null;
    if (value === "Enabled") return true;
    if (value === "Disabled") return false;
    return null;
}

export async function createTeam(ctx: TaskContext, name: string): Promise<void> {
    await openTeamsList(ctx);
    ctx.getMenuItemSlot("Create Team").click();
    await enterValue(ctx, name);
    await waitForMenu(ctx);
}

// Housing displays a team tag wrapped in brackets ("Current Tag: [RED]") but
// stores and accepts the bare value; strip the wrapper for the canonical tag.
function stripTagBrackets(value: string): string {
    if (
        value.length >= 2 &&
        value.charAt(0) === "[" &&
        value.charAt(value.length - 1) === "]"
    ) {
        return value.substring(1, value.length - 1);
    }
    return value;
}

function readTeamTagValue(slot: ItemSlot): string | null {
    const raw = readLabeledLoreValue(slot, CURRENT_TAG_LABEL);
    return raw === null ? null : stripTagBrackets(raw);
}

export function readTeamSettings(ctx: TaskContext): TeamSettings {
    const tagSlot = ctx.tryGetMenuItemSlot(CHANGE_TAG_SLOT);
    const colorSlot = ctx.tryGetMenuItemSlot(CHANGE_COLOR_SLOT);
    const fireSlot = ctx.tryGetMenuItemSlot(FRIENDLY_FIRE_SLOT);
    return {
        tag: tagSlot === null ? null : readTeamTagValue(tagSlot),
        color: colorSlot === null ? null : readLabeledLoreValue(colorSlot, CURRENT_COLOR_LABEL),
        friendlyFire: fireSlot === null ? null : readFriendlyFireValue(fireSlot),
    };
}

export async function setTeamTag(ctx: TaskContext, tag: string): Promise<void> {
    const slot = ctx.getMenuItemSlot(CHANGE_TAG_SLOT);
    if (readTeamTagValue(slot) === tag) return;
    slot.click();
    await enterValue(ctx, tag);
    await waitForMenu(ctx);
}

function findColorOption(ctx: TaskContext, color: string): ItemSlot | null {
    return ctx.tryGetMenuItemSlot((slot) => {
        const name = stripTooltipDebugSuffix(
            removedFormatting(slot.getItem().getName()).trim()
        );
        return name === color;
    });
}

export async function setTeamColor(ctx: TaskContext, color: Color): Promise<void> {
    const slot = ctx.getMenuItemSlot(CHANGE_COLOR_SLOT);
    if (readLabeledLoreValue(slot, CURRENT_COLOR_LABEL) === color) return;

    await openSubmenu(ctx, CHANGE_COLOR_SLOT);
    const optionSlot = findColorOption(ctx, color);
    if (optionSlot === null) {
        throw new Error(
            `Could not find color "${color}" in the team color picker${menuStateDescription()}`
        );
    }
    optionSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    // The picker returns to the manage menu on selection; if it doesn't, unwind.
    if (ctx.tryGetMenuItemSlot(CHANGE_COLOR_SLOT) === null) {
        await clickGoBack(ctx);
    }
}

export async function setTeamFriendlyFire(
    ctx: TaskContext,
    value: boolean
): Promise<void> {
    const slot = ctx.getMenuItemSlot(FRIENDLY_FIRE_SLOT);
    if (readFriendlyFireValue(slot) === value) return;
    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    const updated = readFriendlyFireValue(ctx.getMenuItemSlot(FRIENDLY_FIRE_SLOT));
    if (updated !== null && updated !== value) {
        throw new Error(
            `Failed to set team friendly fire to ${value ? "Enabled" : "Disabled"}.`
        );
    }
}
