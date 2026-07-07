import {
    type ItemCaptureRegistry,
    prettySnbt,
} from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { snbtTargetForItemExport } from "../../project/paths";

export function writeCapturedItems(
    ctx: TaskContext,
    registry: ItemCaptureRegistry,
    rootDir: string,
    importJsonPath: string,
    newExportTargetImportJson?: string,
): number {
    // Seeded entries already exist in the project — only minted ones write.
    const entries = registry.newEntries();
    if (entries.length === 0) return 0;

    for (const item of entries) {
        const target = snbtTargetForItemExport(
            importJsonPath,
            rootDir,
            item.name,
            undefined,
            newExportTargetImportJson
        );
        ensureParentDirs(target.snbtPath);
        FileLib.write(target.snbtPath, prettySnbt(item.snbt), true);

        upsertImportableEntry(target.importJsonPath, "items", {
            name: item.name,
            nbt: target.snbtReference,
        });
        ctx.displayMessage(`&7  -> ${target.snbtPath}`);
    }

    return entries.length;
}
