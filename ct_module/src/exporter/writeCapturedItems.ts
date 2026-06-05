import {
    type ItemCaptureRegistry,
    prettySnbt,
} from "../housingSync/itemCapture";
import TaskContext from "../tasks/context";
import { ensureParentDirs } from "../utils/filesystem";
import { upsertImportableEntry } from "./importJsonWriter";
import { snbtFilenameForItemExport } from "./paths";

export function writeCapturedItems(
    ctx: TaskContext,
    registry: ItemCaptureRegistry,
    rootDir: string,
    importJsonPath: string,
): number {
    const entries = registry.entries();
    if (entries.length === 0) return 0;

    const itemsRoot = `${rootDir}/items`;
    for (const item of entries) {
        const filename = snbtFilenameForItemExport(itemsRoot, item.name);
        const snbtRel = `items/${filename}`;
        const snbtAbs = `${itemsRoot}/${filename}`;
        ensureParentDirs(snbtAbs);
        FileLib.write(snbtAbs, prettySnbt(item.snbt), true);

        upsertImportableEntry(importJsonPath, "items", {
            name: item.name,
            nbt: snbtRel,
        });
        ctx.displayMessage(`&7  -> ${snbtAbs}`);
    }

    return entries.length;
}
