import { SourceMap, parseImportablesResult, type ImportablesParseResult } from "htsw";
import type { ImportableItem } from "htsw/types";

import { FileSystemFileLoader } from "../utils/fileLoaders";

export type ExportProjectContext = {
    rootDir: string;
    importJsonPath: string;
    projectItems: readonly ImportableItem[];
};

export type ExportProjectTarget = Pick<ExportProjectContext, "rootDir" | "importJsonPath">;

export function exportProjectContextFromParsedImportJson(
    target: ExportProjectTarget,
    parsed: ImportablesParseResult | null | undefined
): ExportProjectContext {
    return {
        rootDir: target.rootDir,
        importJsonPath: target.importJsonPath,
        projectItems: projectItemsFromParsedImportJson(parsed),
    };
}

export function readExportProjectContext(target: ExportProjectTarget): ExportProjectContext {
    return {
        rootDir: target.rootDir,
        importJsonPath: target.importJsonPath,
        projectItems: readProjectItemsForExport(target.importJsonPath),
    };
}

export function projectItemsFromParsedImportJson(
    parsed: ImportablesParseResult | null | undefined
): ImportableItem[] {
    if (parsed === null || parsed === undefined) return [];
    const items: ImportableItem[] = [];
    for (const imp of parsed.value) {
        if (imp.type === "ITEM") items.push(imp);
    }
    return items;
}

export function readProjectItemsForExport(importJsonPath: string): ImportableItem[] {
    if (importJsonPath.trim() === "") return [];
    try {
        const parsed = parseImportablesResult(
            new SourceMap(new FileSystemFileLoader()),
            importJsonPath
        );
        return projectItemsFromParsedImportJson(parsed);
    } catch {
        return [];
    }
}
