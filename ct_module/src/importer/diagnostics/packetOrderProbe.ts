/// <reference types="../../../CTAutocomplete" />

/**
 * Runtime probe that answers one question during an import: does a
 * `S30PacketWindowItems` ever arrive for a window BEFORE that window has
 * finished receiving its `S2FPacketSetSlot` packets?
 *
 * If WindowItems is always the final, complete snapshot (arriving after every
 * menu SetSlot), then matching it + 1 tick is safe. If menu-region SetSlots
 * arrive AFTER the WindowItems we'd match, then WindowItems was partial and
 * the scan-too-early bugs are explained.
 *
 * Active only while an import runs (wired from startImport) and only when
 * IMPORT_DEBUG is on. Flip IMPORT_DEBUG off or delete this file + its two
 * call sites in actions.ts to remove.
 */

import {
    S2DPacketOpenWindow,
    S2FPacketSetSlot,
    S30PacketWindowItems,
} from "../../utils/packets";
import { IMPORT_DEBUG } from "./importDebug";

type WindowProbe = {
    windowId: number;
    title: string;
    slotCount: number; // menu slots (excludes 36 player-inventory slots), -1 if unknown
    windowItemsCount: number; // times a WindowItems arrived for this window
    lastWindowItemsMenuItems: number; // non-null menu items in the latest WindowItems
    menuSetSlotsAfterWindowItems: number;
    lateSlotIds: number[];
};

let active = false;
let trigger: { unregister: () => void } | null = null;
let current: WindowProbe | null = null;

const PLAYER_INVENTORY_SLOTS = 36;

function s2dWindowId(p: unknown): number | null {
    try { return (p as { func_148901_c(): number }).func_148901_c(); } catch (_e) { return null; }
}
function s2dTitle(p: unknown): string {
    try {
        const comp = (p as { func_148903_d(): { func_150260_c(): string } }).func_148903_d();
        const text = comp.func_150260_c();
        return text === null || text === undefined ? "?" : text;
    } catch (_e) { return "?"; }
}
function s30WindowId(p: unknown): number | null {
    try { return (p as { func_148911_c(): number }).func_148911_c(); } catch (_e) { return null; }
}
function s30Items(p: unknown): unknown[] | null {
    try { return (p as { func_148910_d(): unknown[] }).func_148910_d(); } catch (_e) { return null; }
}
function s2fWindowId(p: unknown): number | null {
    try { return (p as { func_149175_c(): number }).func_149175_c(); } catch (_e) { return null; }
}
function s2fSlot(p: unknown): number | null {
    try { return (p as { func_149173_e(): number }).func_149173_e(); } catch (_e) { return null; }
}

// The WindowItems array is [menu slots..., 36 player-inventory slots]. The menu
// portion is everything but the last 36, derived from the array itself — no
// reliance on the S2D slotCount getter (whose obf name we don't trust).
function menuSlotCountFromItems(items: unknown[]): number {
    return Math.max(0, items.length - PLAYER_INVENTORY_SLOTS);
}
function countNonNullMenuItems(items: unknown[]): number {
    const end = menuSlotCountFromItems(items);
    let n = 0;
    for (let i = 0; i < end; i++) {
        if (items[i] !== null && items[i] !== undefined) n++;
    }
    return n;
}

function flush(probe: WindowProbe | null): void {
    if (probe === null) return;
    const tag = `window ${probe.windowId} "${probe.title}" (slotCount=${probe.slotCount})`;
    if (probe.windowItemsCount > 0 && probe.lastWindowItemsMenuItems === 0) {
        ChatLib.chat(
            `&6[pkt-probe] ${tag}: EMPTY — WindowItems carried 0 menu items. ` +
            `Likely a transient/"fake" menu Housing opened and discarded; waitForMenu must not latch onto it.`
        );
        return;
    }
    if (probe.menuSetSlotsAfterWindowItems > 0) {
        const slots = probe.lateSlotIds.slice(0, 12).join(", ");
        ChatLib.chat(
            `&c[pkt-probe] ${tag}: ${probe.menuSetSlotsAfterWindowItems} menu SetSlot(s) arrived AFTER WindowItems ` +
            `(WindowItems had ${probe.lastWindowItemsMenuItems} menu items). late slots: ${slots}`
        );
    } else if (probe.windowItemsCount > 0) {
        ChatLib.chat(
            `&a[pkt-probe] ${tag}: clean — WindowItems (${probe.lastWindowItemsMenuItems} menu items) arrived after all menu SetSlots.`
        );
    }
}

function onPacket(packet: unknown): void {
    if (!active) return;

    if (packet instanceof S2DPacketOpenWindow) {
        const id = s2dWindowId(packet);
        if (id === null) return;
        flush(current);
        current = {
            windowId: id,
            title: s2dTitle(packet),
            slotCount: -1, // set from the first WindowItems (array length - 36)
            windowItemsCount: 0,
            lastWindowItemsMenuItems: 0,
            menuSetSlotsAfterWindowItems: 0,
            lateSlotIds: [],
        };
        return;
    }

    if (packet instanceof S30PacketWindowItems) {
        const id = s30WindowId(packet);
        if (id === null || id === 0) return;
        if (current === null || current.windowId !== id) {
            // WindowItems for a window we never saw open (S2D missed or arrived
            // before the probe started) — start a fresh probe so later SetSlots
            // are still attributable. Flag the missing-S2D case in the title.
            flush(current);
            current = {
                windowId: id,
                title: "<no S2D seen>",
                slotCount: -1,
                windowItemsCount: 0,
                lastWindowItemsMenuItems: 0,
                menuSetSlotsAfterWindowItems: 0,
                lateSlotIds: [],
            };
        }
        const items = s30Items(packet);
        current.windowItemsCount++;
        if (items !== null) {
            current.slotCount = menuSlotCountFromItems(items);
            current.lastWindowItemsMenuItems = countNonNullMenuItems(items);
        } else {
            current.lastWindowItemsMenuItems = -1;
        }
        return;
    }

    if (packet instanceof S2FPacketSetSlot) {
        const id = s2fWindowId(packet);
        if (id === null || id === 0) return; // 0 = player inventory, not a menu
        if (current === null || current.windowId !== id) return;
        if (current.windowItemsCount === 0) return; // SetSlot before WindowItems: normal pre-fill
        const slot = s2fSlot(packet);
        if (slot === null) return;
        const isMenuSlot = current.slotCount < 0 ? true : slot < current.slotCount;
        if (!isMenuSlot) return; // player-inventory slot, ignore
        current.menuSetSlotsAfterWindowItems++;
        if (current.lateSlotIds.length < 24) current.lateSlotIds.push(slot);
    }
}

export function startPacketOrderProbe(): void {
    if (!IMPORT_DEBUG || active) return;
    active = true;
    current = null;
    if (trigger === null) {
        trigger = register("packetReceived", (packet: unknown) => onPacket(packet));
    }
}

export function isPacketOrderProbeActive(): boolean {
    return active;
}

export function stopPacketOrderProbe(): void {
    if (!active) return;
    flush(current);
    current = null;
    active = false;
    if (trigger !== null) {
        trigger.unregister();
        trigger = null;
    }
}
