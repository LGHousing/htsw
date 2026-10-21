import { helpers } from "htsw";
import type { ImportableNpc, Pos } from "htsw/types";

import {
    getSlotPaginate,
    readBooleanValue,
    setStringValue,
} from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import type TaskContext from "../../tasks/context";
import type { ItemSlot } from "../../tasks/specifics/slots";
import { normalizeFormattingCodes, removedFormatting } from "../../utils/helpers";
import { openNpcEditorForPos, type NpcListEntry, type NpcLookupCache } from "./listNpcs";

const LOOK_AT_PLAYERS_SLOT = "Look at Players";
const HIDE_NAME_TAG_SLOT = "Hide Name Tag";
const CHANGE_SKIN_SLOT = "Change Skin";

export type NpcSettings = {
    lookAtPlayers: boolean | null;
    hideNameTag: boolean | null;
};

function canonicalNpcName(value: string): string {
    const normalized = normalizeFormattingCodes(value).trim();
    if (normalized.length === 0 || helpers.containsFormattingCode(normalized))
        return normalized;
    return `&a${normalized}`;
}

export function npcNamesMatch(left: string, right: string): boolean {
    return canonicalNpcName(left) === canonicalNpcName(right);
}

function npcNameForInput(value: string): string {
    return normalizeFormattingCodes(value).trim();
}

export function validateSupportedNpcFields(importable: ImportableNpc): void {
    if (importable.equipment !== undefined) {
        throw new Error("NPC equipment import is not currently supported.");
    }
}

function npcToggleSlot(ctx: TaskContext, label: string): ItemSlot | null {
    const prefix = `${label}: `;
    return ctx.tryGetMenuItemSlot(
        (slot) => removedFormatting(slot.getItem().getName()).trim().indexOf(prefix) === 0
    );
}

function readNpcToggle(slot: ItemSlot): boolean | null {
    const name = removedFormatting(slot.getItem().getName()).trim();
    if (/: On$/.test(name)) return true;
    if (/: Off$/.test(name)) return false;
    return null;
}

export function readNpcSettings(ctx: TaskContext): NpcSettings {
    const lookAtPlayers = npcToggleSlot(ctx, LOOK_AT_PLAYERS_SLOT);
    const hideNameTag = npcToggleSlot(ctx, HIDE_NAME_TAG_SLOT);
    return {
        lookAtPlayers: lookAtPlayers === null ? null : readNpcToggle(lookAtPlayers),
        hideNameTag: hideNameTag === null ? null : readNpcToggle(hideNameTag),
    };
}

async function setNpcToggle(
    ctx: TaskContext,
    slotName: string,
    value: boolean
): Promise<void> {
    const slot = npcToggleSlot(ctx, slotName);
    if (slot === null) {
        throw new Error(`Could not find NPC ${slotName.toLowerCase()} setting.`);
    }
    const current = readNpcToggle(slot);
    if (current === value) return;
    if (current === null) {
        throw new Error(`Could not read NPC ${slotName.toLowerCase()} state.`);
    }

    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    const updated = npcToggleSlot(ctx, slotName);
    if (updated === null || readNpcToggle(updated) !== value) {
        throw new Error(
            `Failed to set NPC ${slotName.toLowerCase()} to ${value ? "Enabled" : "Disabled"}.`
        );
    }
}

async function setNpcSkin(
    ctx: TaskContext,
    skin: NonNullable<ImportableNpc["skin"]>
): Promise<void> {
    ctx.getMenuItemSlot(CHANGE_SKIN_SLOT).click();
    await timedWaitForMenu(ctx, "menuClickWait");
    const option = await getSlotPaginate(ctx, skin);
    option.click();
    await ctx.waitFor("tick");
}

export async function applyNpcSettings(
    ctx: TaskContext,
    importable: ImportableNpc
): Promise<void> {
    if (importable.lookAtPlayers !== undefined) {
        await setNpcToggle(ctx, LOOK_AT_PLAYERS_SLOT, importable.lookAtPlayers);
    }
    if (importable.hideNameTag !== undefined) {
        await setNpcToggle(ctx, HIDE_NAME_TAG_SLOT, importable.hideNameTag);
    }
    if (importable.skin !== undefined) await setNpcSkin(ctx, importable.skin);
}

export async function openNpcLeftClickActions(
    ctx: TaskContext,
    importable: { pos: Pos },
    cache?: NpcLookupCache
): Promise<NpcListEntry> {
    const entry = await openNpcEditorForPos(ctx, importable.pos, cache);
    ctx.getMenuItemSlot("Left Click Actions").click();
    await timedWaitForMenu(ctx, "menuClickWait");
    return entry;
}

export async function openNpcRightClickActions(
    ctx: TaskContext,
    importable: { pos: Pos },
    cache?: NpcLookupCache
): Promise<NpcListEntry> {
    const entry = await openNpcEditorForPos(ctx, importable.pos, cache);
    ctx.getMenuItemSlot("Right Click Actions").click();
    await timedWaitForMenu(ctx, "menuClickWait");
    return entry;
}

function leftClickRedirectSlot(ctx: TaskContext): ItemSlot {
    return ctx.getMenuItemSlot("Left Click Redirect");
}

export function readLeftClickRedirect(ctx: TaskContext): boolean {
    const value = readBooleanValue(leftClickRedirectSlot(ctx));
    if (value === null) {
        throw new Error("Could not read NPC left-click redirect state.");
    }
    return value;
}

export async function setLeftClickRedirect(
    ctx: TaskContext,
    value: boolean
): Promise<void> {
    const slot = leftClickRedirectSlot(ctx);
    const current = readBooleanValue(slot);
    if (current === value) return;
    if (current === null) {
        throw new Error("Could not read NPC left-click redirect state.");
    }

    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");

    const updated = readLeftClickRedirect(ctx);
    if (updated !== value) {
        throw new Error(
            `Failed to set NPC left-click redirect to ${value ? "true" : "false"}.`
        );
    }
}

export async function renameNpcIfNeeded(
    ctx: TaskContext,
    live: NpcListEntry,
    importable: ImportableNpc,
    cache?: NpcLookupCache
): Promise<boolean> {
    if (npcNamesMatch(live.name, importable.name)) return false;

    await openNpcEditorForPos(ctx, importable.pos, cache);
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot("Rename NPC"),
        npcNameForInput(importable.name)
    );
    return true;
}
