import {
    ItemCaptureRegistry,
    prettySnbt,
} from "../importer/itemCapture";
import TaskContext from "../tasks/context";
import { ensureParentDirs } from "../utils/filesystem";
import { upsertImportableEntry } from "./importJsonWriter";
import { snbtFilenameForItemExport } from "./paths";

/**
 * Flush every captured item in `registry` to disk as
 * `<rootDir>/items/<slug>.snbt` and upsert an `items[]` entry in
 * `import.json`. Dedup happens earlier in the registry, so each entry
 * here is already unique by NBT hash and canonical name.
 *
 * Shared between function and menu export so they stay symmetric. Pure
 * file IO + the JSONC-comment-preserving upsert — does not consult
 * `ctx.isCancelled()`, so callers can safely run this from a `finally`
 * block to flush partial captures after a `/export stop`.
 */
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
