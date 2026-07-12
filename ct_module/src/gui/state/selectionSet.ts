/**
 * Multi-select for the Projects tab. Independent of single-selection
 * (which drives preview); the checked set drives "Import selected" and the
 * queue-bulk paths.
 */
import type { Importable } from "htsw/types";

import { markGuiDirty } from "../lib/dirty";
import { normalizeHtswPath } from "../lib/pathDisplay";

const checkedImportableKeys: Set<string> = new Set();

export function importableSelectionKey(
    sourcePath: string,
    type: Importable["type"],
    identity: string
): string {
    return `${normalizeHtswPath(sourcePath)}|${type}:${identity}`;
}

export function isImportableChecked(key: string): boolean {
    return checkedImportableKeys.has(key);
}
export function toggleImportableChecked(key: string): boolean {
    if (checkedImportableKeys.has(key)) {
        checkedImportableKeys.delete(key);
        markGuiDirty();
        return false;
    }
    checkedImportableKeys.add(key);
    markGuiDirty();
    return true;
}
export function clearImportableChecks(): void {
    if (checkedImportableKeys.size === 0) return;
    checkedImportableKeys.clear();
    markGuiDirty();
}
