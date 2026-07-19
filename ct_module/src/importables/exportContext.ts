import { SourceMap, parseImportablesResult, type ImportablesParseResult } from "htsw";
import type { ImportableItem } from "htsw/types";

import { FileSystemFileLoader } from "../utils/fileLoaders";
import { ItemCaptureRegistry } from "../housingSync/itemCapture";
import { createItemRegistry } from "./itemRegistry";
import { createItemDependencyIndex } from "./itemDependencyIndex";
import { expectedInteractData } from "./items/interactDataCache";

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
    return projectItemsFromParsedImportJson(
        readParsedImportablesForExport(importJsonPath)
    );
}

export function readParsedImportablesForExport(
    importJsonPath: string
): ImportablesParseResult | null {
    if (importJsonPath.trim() === "") return null;
    try {
        return parseImportablesResult(
            new SourceMap(new FileSystemFileLoader()),
            importJsonPath
        );
    } catch {
        return null;
    }
}

export function createExportItemCaptureRegistry(
    importJsonPath: string,
    housingUuid: string,
    fallbackItems: readonly ImportableItem[] = []
): ItemCaptureRegistry {
    const captures = new ItemCaptureRegistry();
    const parsed = readParsedImportablesForExport(importJsonPath);
    if (parsed !== null) {
        const items = createItemRegistry(parsed.value, parsed.gcx);
        const dependencies = createItemDependencyIndex(parsed.value, items);
        for (const importable of parsed.value) {
            if (importable.type !== "ITEM") continue;
            captures.seedExportItem(
                importable,
                expectedInteractData(importable, dependencies, housingUuid)
            );
        }
        return captures;
    }

    for (const item of fallbackItems) {
        const hasClickActions =
            (item.leftClickActions?.length ?? 0) > 0 ||
            (item.rightClickActions?.length ?? 0) > 0;
        captures.seedExportItem(
            item,
            hasClickActions ? { kind: "uncached" } : { kind: "absent" }
        );
    }
    return captures;
}
