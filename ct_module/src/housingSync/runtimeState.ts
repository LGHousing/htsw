/// <reference types="../../CTAutocomplete" />

/**
 * Shared "an import is currently in flight" flag. Owned by the importer
 * because the importer is the one that knows when its TaskManager run
 * starts and ends. Consumers (GUI progress panel, soundPlay cancel hook,
 * stepGate) read it via `isImportRunning()`.
 */

let importRunning = false;

export function setImportRunning(value: boolean): void {
    importRunning = value;
}

export function isImportRunning(): boolean {
    return importRunning;
}
