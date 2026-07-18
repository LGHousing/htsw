import type { Importable } from "htsw/types";
import { markGuiDirty } from "../../lib/dirty";

export type ExportSelectionItem = {
    uuid: string;
    type: Importable["type"];
    name: string;
};

function keyOf(uuid: string, type: Importable["type"], name: string): string {
    return `${uuid}|${type}|${name}`;
}

let items: ExportSelectionItem[] = [];

export function getExportSelection(): readonly ExportSelectionItem[] {
    return items;
}

export function isInExportSelection(
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

export function toggleExportSelection(item: ExportSelectionItem): boolean {
    const k = keyOf(item.uuid, item.type, item.name);
    for (let i = 0; i < items.length; i++) {
        if (keyOf(items[i].uuid, items[i].type, items[i].name) === k) {
            items = items.filter((_it, idx) => idx !== i);
            markGuiDirty();
            return false;
        }
    }
    items = items.concat([item]);
    markGuiDirty();
    return true;
}

export function addToExportSelection(newItems: readonly ExportSelectionItem[]): number {
    const additions: ExportSelectionItem[] = [];
    for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i];
        if (
            !isInExportSelection(item.uuid, item.type, item.name) &&
            !additions.some(
                (added) =>
                    keyOf(added.uuid, added.type, added.name) ===
                    keyOf(item.uuid, item.type, item.name)
            )
        ) {
            additions.push(item);
        }
    }
    if (additions.length === 0) return 0;
    items = items.concat(additions);
    markGuiDirty();
    return additions.length;
}

export function clearExportSelection(): void {
    if (items.length === 0) return;
    items = [];
    markGuiDirty();
}
