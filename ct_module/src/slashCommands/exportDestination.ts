import type { ProjectExportTarget } from "../importables/export/projectDestination";
import { defaultExportRoot, resolveModuleRelativePath } from "../project/paths";

type ExportDestinationPath = ProjectExportTarget;

function trimTrailingSlashes(path: string): string {
    let end = path.length;
    while (end > 0) {
        const ch = path.charAt(end - 1);
        if (ch !== "/" && ch !== "\\") break;
        end--;
    }
    return path.substring(0, end);
}

function normalizeSlashes(path: string): string {
    return path.split("\\").join("/");
}

function dirname(path: string): string {
    const norm = normalizeSlashes(path);
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}

function endsWithIgnoreCase(value: string, suffix: string): boolean {
    if (value.length < suffix.length) return false;
    return (
        value.substring(value.length - suffix.length).toLowerCase() ===
        suffix.toLowerCase()
    );
}

function exportDestination(
    explicitPath: string | undefined
): ExportDestinationPath | null {
    if (explicitPath === undefined) return null;
    const path = resolveModuleRelativePath(trimTrailingSlashes(explicitPath));
    if (endsWithIgnoreCase(path, ".json")) {
        return { rootDir: dirname(path), importJsonPath: normalizeSlashes(path) };
    }
    const rootDir = normalizeSlashes(path);
    return { rootDir, importJsonPath: `${rootDir}/import.json` };
}

export function queuedExportDestination(
    explicitPath: string | undefined,
    housingUuid: string
): ExportDestinationPath {
    const explicitDestination = exportDestination(explicitPath);
    if (explicitDestination !== null) return explicitDestination;
    const rootDir = defaultExportRoot(housingUuid);
    return { rootDir, importJsonPath: `${rootDir}/import.json` };
}
