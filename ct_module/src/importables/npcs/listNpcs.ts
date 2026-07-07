import type { Pos } from "htsw/types";

import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { isAtMenuTitle } from "../../housingSync/menus/currentMenu";
import {
    findPaginatedListEntry,
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    readPaginatedList,
    type PaginatedListConfig,
} from "../../housingSync/menus/paginatedList";
import TaskContext from "../../tasks/context";
import { ItemSlot, MouseButton } from "../../tasks/specifics/slots";
import { normalizeFormattingCodes, removedFormatting } from "../../utils/helpers";
import { teleportSucceeded } from "../waiters";

const NPC_LIST_CONFIG: PaginatedListConfig = {
    label: "npc",
    emptyPlaceholderName: "No NPCs!",
};

export type NpcListEntry = {
    index: number;
    name: string;
    pos: Pos;
};

export type NpcLookupCache = {
    entriesByPos: Map<string, NpcListEntry>;
};

export function createNpcLookupCache(): NpcLookupCache {
    return { entriesByPos: new Map() };
}

function npcPosIdentity(pos: Pos): string {
    return `${pos.x},${pos.y},${pos.z}`;
}

export function npcLabel(entry: { name: string; pos: Pos }): string {
    return `${removedFormatting(entry.name)} @ ${npcPosIdentity(entry.pos)}`;
}

function stripTooltipDebugSuffix(name: string): string {
    return name
        .replace(/\s*(?:&[0-9a-fklmnor])*\(#[0-9a-fA-F]+(?:\/[0-9]+)?\)\s*$/i, "")
        .trim();
}

function extractNpcName(rawDisplayName: string): string | null {
    const name = stripTooltipDebugSuffix(normalizeFormattingCodes(rawDisplayName));
    return name.length === 0 ? null : name;
}

function parseNpcPos(lore: string[]): Pos | null {
    for (let i = 0; i < lore.length; i++) {
        const line = removedFormatting(lore[i]).trim();
        const match = line.match(/^(-?\d+),\s*(-?\d+),\s*(-?\d+)$/);
        if (match === null) continue;
        return {
            x: Number(match[1]),
            y: Number(match[2]),
            z: Number(match[3]),
        };
    }
    return null;
}

async function openNpcBrowser(ctx: TaskContext): Promise<void> {
    // Already in the NPCs list (e.g. the list phase left us here, possibly on a
    // later page) — skip the /hmenu round-trip. The paginated navigation that
    // follows reads the live page from the title and corrects from any page.
    if (isAtMenuTitle(ctx, "NPCs")) return;

    await ctx.runCommand("/hmenu");
    await timedWaitForMenu(ctx, "commandMenuWait");

    ctx.getMenuItemSlot("Systems").click();
    await timedWaitForMenu(ctx, "menuClickWait");

    ctx.getMenuItemSlot("NPCs").click();
    await timedWaitForMenu(ctx, "menuClickWait");
}

export async function listAllNpcs(
    ctx: TaskContext,
    cache?: NpcLookupCache
): Promise<NpcListEntry[]> {
    await openNpcBrowser(ctx);

    const entries = await readPaginatedList<NpcListEntry>(
        ctx,
        NPC_LIST_CONFIG,
        async () => readVisibleNpcEntries(ctx)
    );
    rememberNpcEntries(cache, entries);
    return entries;
}

function readVisibleNpcEntries(ctx: TaskContext): NpcListEntry[] {
    const out: NpcListEntry[] = [];
    const slots = getVisiblePaginatedItemSlots(ctx);
    for (let i = 0; i < slots.length; i++) {
        const entry = readNpcEntryFromSlot(slots[i], i);
        if (entry !== null) out.push(entry);
    }
    return out;
}

function readNpcEntryFromSlot(slot: ItemSlot, index: number): NpcListEntry | null {
    const item = slot.getItem();
    if (item === null || item === undefined) return null;
    const name = extractNpcName(item.getName());
    const pos = parseNpcPos(item.getLore());
    if (name === null || pos === null) return null;
    return { index, name, pos };
}

function rememberNpcEntries(
    cache: NpcLookupCache | undefined,
    entries: readonly NpcListEntry[]
): void {
    if (cache === undefined) return;
    for (let i = 0; i < entries.length; i++) {
        cache.entriesByPos.set(npcPosIdentity(entries[i].pos), entries[i]);
    }
}

export function findNpcByPos(
    entries: readonly NpcListEntry[],
    pos: Pos
): NpcListEntry | null {
    let found: NpcListEntry | null = null;
    const identity = npcPosIdentity(pos);
    for (let i = 0; i < entries.length; i++) {
        if (npcPosIdentity(entries[i].pos) !== identity) continue;
        if (found !== null) {
            throw new Error(`Multiple NPCs exist at ${identity}; this temporary importer requires unique positions.`);
        }
        found = entries[i];
    }
    return found;
}

export async function openNpcEditorForPos(
    ctx: TaskContext,
    pos: Pos,
    cache?: NpcLookupCache
): Promise<NpcListEntry> {
    await openNpcBrowser(ctx);
    const identity = npcPosIdentity(pos);
    const cached = await tryOpenCachedNpcEditor(ctx, pos, cache);
    if (cached !== null) return cached;

    const found = await findPaginatedListEntry(
        ctx,
        NPC_LIST_CONFIG,
        async () => readVisibleNpcEntries(ctx),
        (entry) => npcPosIdentity(entry.pos) === identity,
        (entries) => rememberNpcEntries(cache, entries)
    );
    if (found === null) {
        throw new Error(`No NPC exists at ${npcPosIdentity(pos)}.`);
    }

    rememberNpcEntries(cache, [found.entry]);
    found.slot.click(MouseButton.LEFT);
    await timedWaitForMenu(ctx, "menuClickWait");
    return found.entry;
}

// The NPC's position is its identity, so teleport straight there with /tp
// rather than opening the browser and right-clicking its slot. The slot's
// right-click teleport emits no chat line to confirm on, while /tp does (the
// same command region-corner setup uses).
export async function teleportToNpc(ctx: TaskContext, pos: Pos): Promise<void> {
    await ctx.expectAfter(
        () => ctx.runCommand(`/tp ${pos.x} ${pos.y} ${pos.z}`),
        teleportSucceeded(pos)
    );
}

async function tryOpenCachedNpcEditor(
    ctx: TaskContext,
    pos: Pos,
    cache: NpcLookupCache | undefined
): Promise<NpcListEntry | null> {
    if (cache === undefined) return null;
    const identity = npcPosIdentity(pos);
    const cached = cache.entriesByPos.get(identity);
    if (cached === undefined) return null;

    try {
        const slot = await getPaginatedListSlotAtIndex(
            ctx,
            cached.index,
            cached.index + 1,
            NPC_LIST_CONFIG
        );
        const live = readNpcEntryFromSlot(slot, cached.index);
        if (live === null || npcPosIdentity(live.pos) !== identity) {
            cache.entriesByPos.delete(identity);
            return null;
        }
        cache.entriesByPos.set(identity, live);
        slot.click(MouseButton.LEFT);
        await timedWaitForMenu(ctx, "menuClickWait");
        return live;
    } catch (_error) {
        cache.entriesByPos.delete(identity);
        return null;
    }
}
