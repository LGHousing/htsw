import type { Importable } from "htsw/types";

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
            return false;
        }
    }
    items = items.concat([item]);
    return true;
}

export function clearExportSelection(): void {
    items = [];
}
