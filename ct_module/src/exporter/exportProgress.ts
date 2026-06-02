/**
 * Callback an export batch invokes to drive the shared import/export
 * progress UI. The exporter only depends on this interface; the concrete
 * GUI-driving implementation lives in `gui/state/exportProgress.ts` and is
 * wired in by `exporter/index.ts`, so the batch loops stay GUI-agnostic.
 */
export type ExportProgressSink = {
    /** Called once the full list of names to export is known. */
    start(names: readonly string[]): void;
    /** Called as item `index` (0-based) begins exporting. */
    item(index: number, name: string): void;
    /** Called once when the batch finishes (success, failure, or cancel). */
    done(): void;
};
