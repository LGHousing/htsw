import type { Importable } from "htsw/types";

// Items the user has staged to export from a house into the loaded import.json.
// Keyed by house so a stale entry from another house can't be exported while
// standing somewhere else (export reads the live housing menu).
export type ExportQueueItem = {
    uuid: string;
    type: Importable["type"];
    name: string;
};

function keyOf(uuid: string, type: Importable["type"], name: string): string {
    return `${uuid}|${type}|${name}`;
}

let items: ExportQueueItem[] = [];

export function getExportQueue(): readonly ExportQueueItem[] {
    return items;
}

export function getExportQueueLength(): number {
    return items.length;
}

export function countExportQueueForHouse(uuid: string | null): number {
    if (uuid === null) return 0;
    let n = 0;
    for (let i = 0; i < items.length; i++) if (items[i].uuid === uuid) n++;
    return n;
}

export function isInExportQueue(
    uuid: string,
    type: Importable["type"],
    name: string
): boolean {
    const k = keyOf(uuid, type, name);
    for (let i = 0; i < items.length; i++) {
        if (keyOf(items[i].uuid, items[i].type, items[i].name) === k) return true;
    }
    return false;
}

/** Toggle membership. Returns the new state (true = now queued). */
export function toggleExportQueue(item: ExportQueueItem): boolean {
    const k = keyOf(item.uuid, item.type, item.name);
    for (let i = 0; i < items.length; i++) {
        if (keyOf(items[i].uuid, items[i].type, items[i].name) === k) {
            items = items.filter((_it, idx) => idx !== i);
            return false;
        }
    }
    items = items.concat([item]);
    return true;
}

export function removeFromExportQueue(
    uuid: string,
    type: Importable["type"],
    name: string
): void {
    const k = keyOf(uuid, type, name);
    items = items.filter((it) => keyOf(it.uuid, it.type, it.name) !== k);
}

export function clearExportQueue(): void {
    items = [];
}
