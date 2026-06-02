import { normalizeHtswPath } from "../lib/pathDisplay";

let importJsonPath = "./htsw/imports/import.json";
let exportImportJsonPath: string | null = null;

export function getImportJsonPath(): string {
    return importJsonPath;
}
export function setImportJsonPath(path: string): void {
    importJsonPath = normalizeHtswPath(path);
}

export function getExportImportJsonPath(): string {
    return exportImportJsonPath === null ? importJsonPath : exportImportJsonPath;
}
export function setExportImportJsonPath(path: string): void {
    exportImportJsonPath = normalizeHtswPath(path);
}
