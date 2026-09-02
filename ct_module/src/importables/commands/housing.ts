import type { CommandMode, ImportableCommand } from "htsw/types";

import {
    readBooleanValue,
    readStringValue,
    setNumberValue,
} from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import type TaskContext from "../../tasks/context";
import type { ItemSlot } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { getSessionCommandNamesLower, noteCommandCreated } from "./listCommands";
import { desiredCommandSettings, type CommandSettings } from "./settings";
import { itemLore } from "../../utils/itemLore";

export async function ensureCommandExists(
    ctx: TaskContext,
    name: string
): Promise<"existing" | "created"> {
    const existing = await getSessionCommandNamesLower(ctx);
    if (existing.has(name.toLowerCase())) return "existing";

    await ctx.runCommand(`/command create ${name}`);
    await timedWaitForMenu(ctx, "commandMenuWait");
    noteCommandCreated(name);
    return "created";
}

export async function openExistingCommandActionsEditor(
    ctx: TaskContext,
    name: string
): Promise<void> {
    const existing = await getSessionCommandNamesLower(ctx);
    if (!existing.has(name.toLowerCase())) {
        throw new Error(`No command named "/${name}" exists in this housing.`);
    }

    await ctx.runCommand(`/command actions ${name}`);
    await timedWaitForMenu(ctx, "commandMenuWait");
}

export async function openCommandSettings(ctx: TaskContext, name: string): Promise<void> {
    await ctx.runCommand(`/command edit ${name}`);
    await timedWaitForMenu(ctx, "commandMenuWait");
}

function readCurrentLine(slot: ItemSlot): string | null {
    const lore = itemLore(slot.getItem());
    for (let i = 0; i < lore.length; i++) {
        const line = removedFormatting(lore[i]).trim();
        const match = line.match(/^Current:\s*(.+)$/);
        if (match !== null) return match[1].trim();
    }
    return null;
}

function readCommandMode(slot: ItemSlot): CommandMode {
    const current = readCurrentLine(slot) ?? readStringValue(slot);
    if (current === "Self" || current === "Targeted") return current;
    throw new Error(`Could not read command mode from "${slot.getItem().getName()}".`);
}

function readRequiredPriority(slot: ItemSlot): number {
    const current = readCurrentLine(slot) ?? readStringValue(slot);
    if (current === null) {
        throw new Error("Could not read required group priority.");
    }
    const value = Number(current.split(",").join(""));
    if (!Number.isInteger(value) || value < 0 || value > 20) {
        throw new Error(`Invalid required group priority: ${current}`);
    }
    return value;
}

function readListedValue(slot: ItemSlot): boolean | null {
    const generic = readBooleanValue(slot);
    if (generic !== null) return generic;

    const current = readCurrentLine(slot);
    if (
        current === "Enabled" ||
        current === "Listed" ||
        current === "Yes" ||
        current === "True"
    ) {
        return true;
    }
    if (
        current === "Disabled" ||
        current === "Unlisted" ||
        current === "No" ||
        current === "False"
    ) {
        return false;
    }

    const item = slot.getItem();
    try {
        if (item.getRegistryName() === "minecraft:dye") {
            const metadata = item.getMetadata();
            if (metadata === 10) return true;
            if (metadata === 8) return false;
        }
    } catch (_e) {}

    return null;
}

async function setListedValue(
    ctx: TaskContext,
    slot: ItemSlot,
    value: boolean
): Promise<void> {
    const current = readListedValue(slot);
    if (current === null) {
        throw new Error(
            'Could not read the "Listed" toggle state from the current menu item.'
        );
    }
    if (current === value) return;

    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");

    const updated = readListedValue(ctx.getMenuItemSlot("Listed"));
    if (updated !== value) {
        throw new Error(`Failed to set "Listed" to ${value ? "true" : "false"}.`);
    }
}

export function readOpenCommandSettings(ctx: TaskContext): CommandSettings {
    return {
        mode: readCommandMode(ctx.getMenuItemSlot("Toggle Command Mode")),
        requiredPriority: readRequiredPriority(
            ctx.getMenuItemSlot("Required Group Priority")
        ),
        listed: readListedValue(ctx.getMenuItemSlot("Listed")),
    };
}

export async function applyCommandSettings(
    ctx: TaskContext,
    importable: ImportableCommand
): Promise<void> {
    const desired = desiredCommandSettings(importable);

    const modeSlot = ctx.getMenuItemSlot("Toggle Command Mode");
    if (readCommandMode(modeSlot) !== desired.mode) {
        modeSlot.click();
        await timedWaitForMenu(ctx, "menuClickWait");
    }

    const prioritySlot = ctx.getMenuItemSlot("Required Group Priority");
    if (readRequiredPriority(prioritySlot) !== desired.requiredPriority) {
        await setNumberValue(ctx, prioritySlot, desired.requiredPriority);
    }

    const listedSlot = ctx.getMenuItemSlot("Listed");
    const currentListed = readListedValue(listedSlot);
    if (currentListed === null) {
        throw new Error(
            'Could not read the "Listed" toggle state from the current menu item.'
        );
    }
    if (currentListed !== desired.listed) {
        await setListedValue(ctx, listedSlot, desired.listed);
    }
}
