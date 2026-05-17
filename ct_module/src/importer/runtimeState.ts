/// <reference types="../../CTAutocomplete" />

/**
 * Tiny shared flag for "the importer is currently running an import".
 *
 * Owned by the importer because the importer is the one that knows
 * whether a TaskManager run is in flight. Consumers (the GUI's progress
 * panel, `sideEffects`'s soundPlay cancel hook, `stepGate`) read it via
 * `isImportRunning()`.
 *
 * Keeping this here (rather than reaching from importer back into
 * `gui/state/index.ts:getImportProgress()`) preserves the layering
 * convention: GUI imports importer, never reverse.
 *
 * `startImport` flips the flag in its TaskManager.run try/finally so
 * cancellation, errors, and successful completion all clear it.
 */

let importRunning = false;

export function setImportRunning(value: boolean): void {
    importRunning = value;
}

export function isImportRunning(): boolean {
    return importRunning;
}
