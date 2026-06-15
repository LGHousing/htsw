import {
    canonicalSlug,
    htslTargetForEventExport as htslTargetForEventExportWithFs,
    htslTargetForFunctionExport as htslTargetForFunctionExportWithFs,
    readEventNamesFromImportJson as readEventNamesFromImportJsonWithFs,
    readFunctionNamesFromImportJson as readFunctionNamesFromImportJsonWithFs,
    snbtTargetForItemExport as snbtTargetForItemExportWithFs,
    type HtslExportTarget,
    type SnbtExportTarget,
} from "htsw-editor-common/project";
import { ctProjectFs } from "./projectFs";

export { canonicalSlug, type HtslExportTarget, type SnbtExportTarget };

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

export function readFunctionNamesFromImportJson(importJsonPath: string): string[] {
    return readFunctionNamesFromImportJsonWithFs(ctProjectFs, importJsonPath);
}

export function readEventNamesFromImportJson(importJsonPath: string): string[] {
    return readEventNamesFromImportJsonWithFs(ctProjectFs, importJsonPath);
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

export function snbtTargetForItemExport(
    entryImportJsonPath: string,
    rootDir: string,
    itemName: string
): SnbtExportTarget {
    return snbtTargetForItemExportWithFs(
        ctProjectFs,
        entryImportJsonPath,
        rootDir,
        itemName
    );
}
