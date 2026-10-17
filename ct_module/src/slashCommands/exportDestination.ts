import type { ProjectExportTarget } from "../importables/export/projectDestination";
import { normalizePathSeparators, parentDir } from "htsw-editor-common/project";
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
        return { rootDir: parentDir(path), importJsonPath: normalizePathSeparators(path) };
    }
    const rootDir = normalizePathSeparators(path);
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
