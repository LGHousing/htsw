import { normalizeHtswPath } from "../lib/pathDisplay";
import { getHousingUuid } from "./housing";
import { boundImportJsonPath } from "../../importCache/houseBindings";
import { markGuiDirty } from "../lib/dirty";

let importJsonPath = "";
let exportImportJsonPath: string | null = null;

export function getImportJsonPath(): string {
    return importJsonPath;
}
export function setImportJsonPath(path: string): void {
    const next = normalizeHtswPath(path);
    if (next === importJsonPath) return;
    importJsonPath = next;
    markGuiDirty();
}

// The effective export destination. A manual pick wins; otherwise it falls back
// to the current house's bound file (so standing in a bound house Just Works,
// even after a /ct reload where no uuid transition fired the auto-select), and
// finally to the active path. `boundImportJsonPath` reads a short-cached map, so
// this stays cheap on the hot path and only runs while nothing is picked.
export function getExportImportJsonPath(): string {
    if (exportImportJsonPath !== null) return exportImportJsonPath;
    const uuid = getHousingUuid();
    if (uuid !== null) {
        const bound = boundImportJsonPath(uuid);
        if (bound !== null && bound.trim() !== "") return normalizeHtswPath(bound);
    }
    return importJsonPath;
}
export function setExportImportJsonPath(path: string): void {
    const next = normalizeHtswPath(path);
    if (next === exportImportJsonPath) return;
    exportImportJsonPath = next;
    markGuiDirty();
}

export function clearExportImportJsonPath(): void {
    if (exportImportJsonPath === null) return;
    exportImportJsonPath = null;
    markGuiDirty();
}
