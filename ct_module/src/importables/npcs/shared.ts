import { helpers } from "htsw";
import type { ImportableNpc, Pos } from "htsw/types";

import {
    readBooleanValue,
    setStringValue,
} from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import TaskContext from "../../tasks/context";
import type { ItemSlot } from "../../tasks/specifics/slots";
import { normalizeFormattingCodes } from "../../utils/helpers";
import { openNpcEditorForPos, type NpcListEntry, type NpcLookupCache } from "./listNpcs";

function canonicalNpcName(value: string): string {
    const normalized = normalizeFormattingCodes(value).trim();
    if (normalized.length === 0 || helpers.containsFormattingCode(normalized)) return normalized;
    return `&a${normalized}`;
}

export function npcNamesMatch(left: string, right: string): boolean {
    return canonicalNpcName(left) === canonicalNpcName(right);
}

function npcNameForInput(value: string): string {
    return normalizeFormattingCodes(value).trim();
}

export function validateSupportedNpcFields(importable: ImportableNpc): void {
    const unsupported: string[] = [];
    if (importable.lookAtPlayers !== undefined) unsupported.push("lookAtPlayers");
    if (importable.hideNameTag !== undefined) unsupported.push("hideNameTag");
    if (importable.skin !== undefined) unsupported.push("skin");
    if (importable.equipment !== undefined) unsupported.push("equipment");
    if (unsupported.length > 0) {
        throw new Error(
            `NPC import currently supports only name, pos, leftClickActions, rightClickActions, and leftClickRedirect; unsupported field${unsupported.length === 1 ? "" : "s"}: ${unsupported.join(", ")}.`
        );
    }
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
        throw new Error(`Failed to set NPC left-click redirect to ${value ? "true" : "false"}.`);
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
