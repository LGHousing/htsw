import {
    canonicalSlug,
    commandExportReferencesExist as commandExportReferencesExistWithFs,
    eventExportReferencesExist as eventExportReferencesExistWithFs,
    functionExportReferencesExist as functionExportReferencesExistWithFs,
    htslTargetForCommandExport as htslTargetForCommandExportWithFs,
    htslTargetForEventExport as htslTargetForEventExportWithFs,
    htslTargetForFunctionExport as htslTargetForFunctionExportWithFs,
    htslTargetsForRegionExport as htslTargetsForRegionExportWithFs,
    htslTargetsForNpcExport as htslTargetsForNpcExportWithFs,
    readEventNamesFromImportJson as readEventNamesFromImportJsonWithFs,
    readFunctionNamesFromImportJson as readFunctionNamesFromImportJsonWithFs,
    readMenuNamesFromImportJson as readMenuNamesFromImportJsonWithFs,
    readCommandNamesFromImportJson as readCommandNamesFromImportJsonWithFs,
    readNpcEntriesFromImportJson as readNpcEntriesFromImportJsonWithFs,
    readRegionNamesFromImportJson as readRegionNamesFromImportJsonWithFs,
    menuExportReferencesExist as menuExportReferencesExistWithFs,
    npcExportReferencesExist as npcExportReferencesExistWithFs,
    regionExportReferencesExist as regionExportReferencesExistWithFs,
    snbtTargetForItemExport as snbtTargetForItemExportWithFs,
    type HtslExportTarget,
    type NpcExportEntry,
    type NpcHtslExportTargets,
    type RegionHtslExportTargets,
    type SnbtExportTarget,
} from "htsw-editor-common/project";
import { ctProjectFs } from "./projectFs";

export { canonicalSlug, type HtslExportTarget, type NpcExportEntry, type NpcHtslExportTargets, type RegionHtslExportTargets, type SnbtExportTarget };

export const PROJECTS_ROOT = "./htsw/projects";

export function resolveModuleRelativePath(path: string): string {
    if (path.length === 0) return path;
    const normalized = path.split("\\").join("/");
    if (normalized.charAt(0) === ".") return path;
    if (normalized.charAt(0) === "/") return path;
    if (/^[A-Za-z]:/.test(normalized)) return path;
    return `${PROJECTS_ROOT}/${normalized}`;
}

export function defaultExportRoot(housingUuid: string): string {
    return `${PROJECTS_ROOT}/${housingUuid}`;
}

export function parentDirOf(path: string): string {
    return ctProjectFs.parentDir(path);
}

export function projectPathExists(path: string): boolean {
    return ctProjectFs.exists(path);
}

export function readFunctionNamesFromImportJson(importJsonPath: string): string[] {
    return readFunctionNamesFromImportJsonWithFs(ctProjectFs, importJsonPath);
}

export function readEventNamesFromImportJson(importJsonPath: string): string[] {
    return readEventNamesFromImportJsonWithFs(ctProjectFs, importJsonPath);
}

export function readRegionNamesFromImportJson(importJsonPath: string): string[] {
    return readRegionNamesFromImportJsonWithFs(ctProjectFs, importJsonPath);
}

export function readMenuNamesFromImportJson(importJsonPath: string): string[] {
    return readMenuNamesFromImportJsonWithFs(ctProjectFs, importJsonPath);
}

export function readCommandNamesFromImportJson(importJsonPath: string): string[] {
    return readCommandNamesFromImportJsonWithFs(ctProjectFs, importJsonPath);
}

export function readNpcEntriesFromImportJson(importJsonPath: string): NpcExportEntry[] {
    return readNpcEntriesFromImportJsonWithFs(ctProjectFs, importJsonPath);
}

export function functionExportReferencesExist(
    importJsonPath: string,
    name: string
): boolean {
    return functionExportReferencesExistWithFs(ctProjectFs, importJsonPath, name);
}

export function eventExportReferencesExist(
    importJsonPath: string,
    event: string
): boolean {
    return eventExportReferencesExistWithFs(ctProjectFs, importJsonPath, event);
}

export function commandExportReferencesExist(
    importJsonPath: string,
    name: string
): boolean {
    return commandExportReferencesExistWithFs(ctProjectFs, importJsonPath, name);
}

export function npcExportReferencesExist(
    importJsonPath: string,
    entry: NpcExportEntry
): boolean {
    return npcExportReferencesExistWithFs(ctProjectFs, importJsonPath, entry.pos);
}

export function menuExportReferencesExist(
    importJsonPath: string,
    name: string
): boolean {
    return menuExportReferencesExistWithFs(ctProjectFs, importJsonPath, name);
}

export function regionExportReferencesExist(
    importJsonPath: string,
    name: string
): boolean {
    return regionExportReferencesExistWithFs(ctProjectFs, importJsonPath, name);
}

export function htslTargetForFunctionExport(
    entryImportJsonPath: string,
    identity: string
): HtslExportTarget {
    return htslTargetForFunctionExportWithFs(ctProjectFs, entryImportJsonPath, identity);
}

export function htslTargetForEventExport(
    entryImportJsonPath: string,
    identity: string
): HtslExportTarget {
    return htslTargetForEventExportWithFs(ctProjectFs, entryImportJsonPath, identity);
}

export function htslTargetForCommandExport(
    entryImportJsonPath: string,
    identity: string
): HtslExportTarget {
    return htslTargetForCommandExportWithFs(ctProjectFs, entryImportJsonPath, identity);
}

export function htslTargetsForRegionExport(
    entryImportJsonPath: string,
    identity: string
): RegionHtslExportTargets {
    return htslTargetsForRegionExportWithFs(ctProjectFs, entryImportJsonPath, identity);
}

export function htslTargetsForNpcExport(
    entryImportJsonPath: string,
    entry: NpcExportEntry
): NpcHtslExportTargets {
    return htslTargetsForNpcExportWithFs(ctProjectFs, entryImportJsonPath, entry);
}

export function snbtTargetForItemExport(
    entryImportJsonPath: string,
    rootDir: string,
    itemName: string,
    subdir?: string
): SnbtExportTarget {
    return snbtTargetForItemExportWithFs(
        ctProjectFs,
        entryImportJsonPath,
        rootDir,
        itemName,
        subdir
    );
}
