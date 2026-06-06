/// <reference types="../../CTAutocomplete" />

import type { Importable } from "htsw/types";
import type { FunctionListEntry } from "../importables/functions/listFunctions";

// One entry in a house's contents. `icon` is FUNCTION-specific today but lives
// here so the store stays type-agnostic; other content types simply leave it
// unset.
export type HouseItem = { name: string; icon?: FunctionListEntry["icon"] };

export type ContentType = Importable["type"];

// Ground-truth "what's actually in this house", scanned from the Housing menu
// and kept fresh by the per-type live chat triggers. Deliberately separate from
// the import/diff cache (`importCache/`): that answers "what we last synced",
// this answers "what exists right now". Their divergence is the diff.
const STORE_PATH = "./config/ChatTriggers/modules/HTSW/house-contents.json";

const byHouse = new Map<string, Map<ContentType, HouseItem[]>>();
const scannedKeys = new Set<string>();
let loaded = false;

function scanKey(uuid: string, type: ContentType): string {
    return `${uuid}|${type}`;
}

function load(): void {
    if (loaded) return;
    loaded = true;
    try {
        if (!FileLib.exists(STORE_PATH)) return;
        const raw = String(FileLib.read(STORE_PATH) ?? "");
        if (raw.trim() === "") return;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object") return;
        for (const uuid in parsed) {
            if (!Object.prototype.hasOwnProperty.call(parsed, uuid)) continue;
            const perType = (parsed as Record<string, unknown>)[uuid];
            if (perType === null || typeof perType !== "object") continue;
            const map = new Map<ContentType, HouseItem[]>();
            for (const type in perType as Record<string, unknown>) {
                if (!Object.prototype.hasOwnProperty.call(perType, type)) continue;
                const arr = (perType as Record<string, unknown>)[type];
                if (!Array.isArray(arr)) continue;
                const list: HouseItem[] = [];
                for (let i = 0; i < arr.length; i++) {
                    const it = arr[i];
                    if (it !== null && typeof it === "object" && typeof it.name === "string") {
                        list.push({ name: it.name, icon: it.icon ?? null });
                    }
                }
                map.set(type as ContentType, list);
                scannedKeys.add(scanKey(uuid, type as ContentType));
            }
            byHouse.set(uuid, map);
        }
    } catch (_e) {
        // ignore a corrupt store; a rescan rebuilds it
    }
}

function persist(): void {
    try {
        const obj: Record<string, Record<string, HouseItem[]>> = {};
        byHouse.forEach((perType, uuid) => {
            const o: Record<string, HouseItem[]> = {};
            perType.forEach((list, type) => {
                if (scannedKeys.has(scanKey(uuid, type))) o[type] = list;
            });
            if (Object.keys(o).length > 0) obj[uuid] = o;
        });
        FileLib.write(STORE_PATH, JSON.stringify(obj, null, 2), true);
    } catch (_e) {
        // ignore
    }
}

function store(uuid: string, type: ContentType, items: HouseItem[]): void {
    const sorted = items.slice().sort((a, b) => a.name.localeCompare(b.name));
    let map = byHouse.get(uuid);
    if (map === undefined) {
        map = new Map();
        byHouse.set(uuid, map);
    }
    map.set(type, sorted);
}

export function getItems(uuid: string | null, type: ContentType): HouseItem[] {
    load();
    if (uuid === null) return [];
    const map = byHouse.get(uuid);
    if (map === undefined) return [];
    return map.get(type) ?? [];
}

export function isScanned(uuid: string | null, type: ContentType): boolean {
    load();
    return uuid !== null && scannedKeys.has(scanKey(uuid, type));
}

/** Replace a type's full list from a fresh scan and mark it scanned. */
export function recordScan(uuid: string, type: ContentType, items: HouseItem[]): void {
    load();
    store(uuid, type, items);
    scannedKeys.add(scanKey(uuid, type));
    persist();
}

// Liveness: Hypixel announces create/delete/rename in chat. These come from the
// server (not our own ChatLib.chat output), so the trigger fires for both manual
// edits and edits we make during an import. Only the house we're standing in can
// change, so every mutation targets the current UUID.
export function liveAdd(uuid: string, type: ContentType, name: string): void {
    load();
    const list = getItems(uuid, type);
    if (list.some((i) => i.name.toLowerCase() === name.toLowerCase())) return;
    store(uuid, type, list.concat([{ name, icon: null }]));
    persist();
}

export function liveRemove(uuid: string, type: ContentType, name: string): void {
    load();
    const map = byHouse.get(uuid);
    if (map === undefined || !map.has(type)) return;
    store(uuid, type, getItems(uuid, type).filter((i) => i.name.toLowerCase() !== name.toLowerCase()));
    persist();
}

export function liveRename(
    uuid: string,
    type: ContentType,
    oldName: string,
    newName: string
): void {
    load();
    const map = byHouse.get(uuid);
    if (map === undefined || !map.has(type)) return;
    store(
        uuid,
        type,
        getItems(uuid, type).map((i) =>
            i.name.toLowerCase() === oldName.toLowerCase() ? { name: newName, icon: i.icon } : i
        )
    );
    persist();
}

/** Drop the scanned flag so the UI forces a fresh rescan (used when a live
 *  rename is ambiguous and can't be applied safely). */
export function markUnscanned(uuid: string, type: ContentType): void {
    load();
    scannedKeys.delete(scanKey(uuid, type));
    persist();
}
