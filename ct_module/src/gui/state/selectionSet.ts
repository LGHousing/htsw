/**
 * Multi-select for the Importables tab. Keyed by `importableKey`
 * (`${type}:${identity}`). Independent of single-selection (which drives
 * preview); the checked set drives "Import selected" and the queue-bulk paths.
 */
const checkedImportableKeys: Set<string> = new Set();

export function isImportableChecked(key: string): boolean {
    return checkedImportableKeys.has(key);
}
export function toggleImportableChecked(key: string): boolean {
    if (checkedImportableKeys.has(key)) {
        checkedImportableKeys.delete(key);
        return false;
    }
    checkedImportableKeys.add(key);
    return true;
}
export function clearImportableChecks(): void {
    checkedImportableKeys.clear();
}
