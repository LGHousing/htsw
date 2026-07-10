import type { Action, ImportableItem } from "htsw/types";
import * as htsw from "htsw";

import TaskContext from "../../tasks/context";
import { readActionListFully } from "../../housingSync/actions/hydration/run";
import { ItemCaptureRegistry } from "../../housingSync/itemCapture";
import { closeOpenScreen } from "../../housingSync/sideEffects";
import { menuOpened } from "../../housingSync/menus/menuWaiters";
import { importJsonTargetForSectionEntry } from "../../project/paths";
import { updateImportableField } from "../../project/importJsonMutations";
import { isUnspawnableItem } from "../../housingSync/items/unspawnableItems";
import { getItemFromNbt } from "../../utils/nbt";
import { ensureParentDirs } from "../../utils/filesystem";
import { removedFormatting } from "../../utils/helpers";
import { selectedHotbarSlot } from "../../housingSync/menus/packets";
import type { ProgressHandler } from "../../housingSync/progress/types";
import { itemEditorOpened } from "../waiters";
import { createExportProgressSink } from "../../gui/export/progressSink";
import type { ExportDestination } from "../../slashCommands/exportDestination";
import {
    injectHeldItem,
    restoreHeldItemInjectionSlot,
    snapshotHeldItemInjectionSlot,
} from "./heldItem";
import {
    itemActionSummaryHasActions,
    itemActionPaths,
    itemIdFromNbt,
    itemNbtHasInteractData,
} from "./exportLogic";
import { writeCapturedItems } from "./writeCapturedItems";
import { isTaskCancelled } from "../../tasks/manager";

type Side = "left" | "right";

async function pace(ctx: TaskContext): Promise<void> {
    for (let i = 0; i < 4; i++) await ctx.waitFor("tick");
}

function itemActionsOpened() {
    return menuOpened({
        kind: "menuClickWait",
        label: "Waiting for Item Actions",
        title: "Item Actions",
        items: ["Left Click Actions", "Right Click Actions", "Go Back"],
    });
}

function actionEditorOpened() {
    return menuOpened({
        kind: "menuClickWait",
        label: "Waiting for item action list",
        title: "Edit Actions",
        items: ["Add Action", "Copy Actions", "Go Back"],
    });
}

function relativePath(fromJsonPath: string, targetPath: string): string {
    const Paths = Java.type("java.nio.file.Paths");
    const from = Paths.get(String(fromJsonPath)).toAbsolutePath().normalize().getParent();
    const target = Paths.get(String(targetPath)).toAbsolutePath().normalize();
    return String(from.relativize(target).toString()).split("\\").join("/");
}

function writeActions(ctx: TaskContext, path: string, actions: readonly Action[]): void {
    const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
    for (let i = 0; i < diagnostics.length; i++) {
        ctx.displayMessage(`&7[export] &e${diagnostics[i].message}`);
    }
    ensureParentDirs(path);
    FileLib.write(path, source, true);
    ctx.displayMessage(`&7  -> ${path}`);
}

async function readSide(
    ctx: TaskContext,
    side: Side,
    itemCaptures: ItemCaptureRegistry,
    onProgress?: ProgressHandler
): Promise<Action[] | undefined> {
    const label = side === "left" ? "Left Click Actions" : "Right Click Actions";
    const slot = ctx.getMenuItemSlot(label);
    if (!itemActionSummaryHasActions(slot.getItem().getLore())) return undefined;

    await ctx.expectAfter(() => slot.click(), actionEditorOpened());
    await pace(ctx);
    return await readActionListFully(ctx, {
        itemCaptures,
        ...(onProgress === undefined
            ? {}
            : {
                  progress: onProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }),
    });
}

async function openHeldItemActions(ctx: TaskContext): Promise<void> {
    await ctx.expectAfter(() => ctx.runCommand("/edit"), itemEditorOpened());
    await pace(ctx);
    const editActions = ctx.getMenuItemSlot((slot) =>
        slot.getSlotId() === 34 && removedFormatting(slot.getItem().getName()) === "Edit Actions"
    );
    await ctx.expectAfter(() => editActions.click(), itemActionsOpened());
    await pace(ctx);
}

async function exportOpenHeldItem(
    ctx: TaskContext,
    name: string,
    outputDir: string,
    itemCaptures: ItemCaptureRegistry,
    onProgress?: ProgressHandler
): Promise<{ leftPath?: string; rightPath?: string }> {
    await openHeldItemActions(ctx);
    const paths = itemActionPaths(outputDir, name);
    const result: { leftPath?: string; rightPath?: string } = {};
    try {
        const left = await readSide(ctx, "left", itemCaptures, onProgress);
        if (left !== undefined) {
            result.leftPath = paths.left;
            writeActions(ctx, result.leftPath, left);
            await closeOpenScreen(ctx);
            await openHeldItemActions(ctx);
        }

        const right = await readSide(ctx, "right", itemCaptures, onProgress);
        if (right !== undefined) {
            result.rightPath = paths.right;
            writeActions(ctx, result.rightPath, right);
        }
        return result;
    } finally {
        await closeOpenScreen(ctx);
    }
}

export async function exportHeldItemActions(
    ctx: TaskContext,
    destination: ExportDestination
): Promise<void> {
    const slot = Player.getInventory()?.getStackInSlot(selectedHotbarSlot());
    if (slot === null || slot === undefined) {
        throw new Error("Please hold the item you wish to edit!");
    }
    const name = removedFormatting(slot.getName()).trim() || "item";
    const captures = new ItemCaptureRegistry();
    for (let i = 0; i < destination.projectItems.length; i++) {
        captures.seed(destination.projectItems[i].name, destination.projectItems[i].nbt);
    }
    const files = await exportOpenHeldItem(ctx, name, destination.rootDir, captures);
    writeCapturedItems(ctx, captures, destination.rootDir, destination.importJsonPath);
    const count = Number(files.leftPath !== undefined) + Number(files.rightPath !== undefined);
    ctx.displayMessage(`&aExported ${count} action file${count === 1 ? "" : "s"} for held item '${name}'.`);
}

export async function exportManifestItemActions(
    ctx: TaskContext,
    destination: ExportDestination
): Promise<void> {
    const candidates = destination.projectItems.filter((item) => itemNbtHasInteractData(item.nbt));
    const progress = createExportProgressSink("ITEM", destination.importJsonPath);
    const captures = new ItemCaptureRegistry();
    for (let i = 0; i < destination.projectItems.length; i++) {
        captures.seed(destination.projectItems[i].name, destination.projectItems[i].nbt);
    }
    const snapshot = snapshotHeldItemInjectionSlot();
    let exported = 0;
    let skipped = 0;
    let failed = 0;
    progress.start(candidates.map((item) => item.name));
    try {
        for (let i = 0; i < candidates.length; i++) {
            const item: ImportableItem = candidates[i];
            progress.item(i, item.name);
            ctx.checkCancelled();
            const itemId = itemIdFromNbt(item.nbt);
            if (itemId !== null && isUnspawnableItem(itemId)) {
                skipped++;
                ctx.displayMessage(`&7[export] &eSkipping unspawnable item '${item.name}' (${itemId}).`);
                continue;
            }

            try {
                await injectHeldItem(ctx, getItemFromNbt(item.nbt));
                const files = await exportOpenHeldItem(
                    ctx,
                    item.name,
                    destination.rootDir,
                    captures,
                    (payload) => progress.itemProgress?.(i, payload)
                );
                const declaringJson = importJsonTargetForSectionEntry(
                    destination.importJsonPath,
                    "items",
                    item.name
                );
                if (files.leftPath !== undefined) {
                    const updated = updateImportableField(declaringJson, "items", item.name, "leftClickActions", relativePath(declaringJson, files.leftPath));
                    if (!updated) throw new Error(`Could not attach leftClickActions to '${item.name}'.`);
                }
                if (files.rightPath !== undefined) {
                    const updated = updateImportableField(declaringJson, "items", item.name, "rightClickActions", relativePath(declaringJson, files.rightPath));
                    if (!updated) throw new Error(`Could not attach rightClickActions to '${item.name}'.`);
                }
                exported++;
            } catch (error) {
                if (isTaskCancelled(error)) throw error;
                failed++;
                progress.itemFailed?.(i, String(error));
                ctx.displayMessage(`&c[export] failed on item '${item.name}': ${error}`);
            }
        }
    } finally {
        progress.done();
        try {
            writeCapturedItems(ctx, captures, destination.rootDir, destination.importJsonPath);
        } finally {
            await restoreHeldItemInjectionSlot(ctx, snapshot);
        }
    }
    ctx.displayMessage(`&aExported item actions for ${exported} item${exported === 1 ? "" : "s"}${skipped > 0 ? `; skipped ${skipped}` : ""}${failed > 0 ? `; failed ${failed}` : ""}.`);
    ctx.displayMessage(`&7  -> ${destination.importJsonPath}`);
}
