import {
    type ItemCaptureRegistry,
    portableItemSnbt,
} from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { snbtTargetForItemExport } from "../../project/paths";
import { actionPath, actionReference, readClickActions, writeActions } from "./clickActionsExport";

export async function writeCapturedItems(
    ctx: TaskContext,
    registry: ItemCaptureRegistry,
    rootDir: string,
    importJsonPath: string,
    newExportTargetImportJson?: string
): Promise<number> {
    if (registry.newEntries().length === 0) return 0;

    const written = new Set<string>();

    while (true) {
        const item = registry.newEntries().find((entry) => !written.has(entry.name));
        if (item === undefined) break;
        written.add(item.name);
        const actions = await readClickActions(ctx, item, registry);
        const target = snbtTargetForItemExport(
            importJsonPath,
            rootDir,
            item.name,
            undefined,
            newExportTargetImportJson
        );
        ensureParentDirs(target.snbtPath);
        FileLib.write(target.snbtPath, portableItemSnbt(item.snbt), true);

        if (actions.left !== undefined) {
            writeActions(ctx, actionPath(target.snbtPath, "left"), actions.left);
        }
        if (actions.right !== undefined) {
            writeActions(ctx, actionPath(target.snbtPath, "right"), actions.right);
        }

        upsertImportableEntry(target.importJsonPath, "items", {
            name: item.name,
            nbt: target.snbtReference,
            ...(actions.left !== undefined
                ? { leftClickActions: actionReference(target.snbtReference, "left") }
                : {}),
            ...(actions.right !== undefined
                ? { rightClickActions: actionReference(target.snbtReference, "right") }
                : {}),
        });
        ctx.displayMessage(`&7  -> ${target.snbtPath}`);
    }

    return written.size;
}
