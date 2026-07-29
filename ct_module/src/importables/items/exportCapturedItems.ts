import * as htsw from "htsw";
import type { Action } from "htsw/types";

import { readActionListFully } from "../../housingSync/actions/hydration/run";
import { shallowActionListHasActions } from "../../housingSync/fields/loreParsing";
import {
    restoreTemporarilyHeldItem,
    temporarilyHoldItem,
} from "../../housingSync/items/heldItem";
import { portableItemSnbt } from "../../housingSync/items/itemNbt";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { writeImportableCache } from "../../importCache/cache";
import { upsertHouseLockImportable } from "../../importCache/houseLock";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { snbtTargetForItemExport } from "../../project/paths";
import TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import { getItemFromSnbt } from "../../utils/nbt";
import { createItemDependencyIndex } from "./dependencyIndex";
import { createProjectItemIndex } from "./projectItems";
import { readParsedImportablesForExport } from "../export/projectDestination";
import { itemEditorOpened } from "../waiters";
import { type CapturedItem, type ItemCaptureRegistry } from "./captureRegistry";
import { hasItemClickActions, writeInteractDataCache } from "./interactDataCache";
import { sourceItemFieldContent } from "../../housingSync/items/fieldContent";

type ExportedClickActions = {
    left?: Action[];
    right?: Action[];
};

async function readOpenActionList(
    ctx: TaskContext,
    registry: ItemCaptureRegistry
): Promise<Action[]> {
    return readActionListFully(ctx, {
        itemReadMode: "export",
        itemCaptures: registry,
    });
}

async function readClickActions(
    ctx: TaskContext,
    item: CapturedItem,
    registry: ItemCaptureRegistry
): Promise<ExportedClickActions> {
    const held = await temporarilyHoldItem(ctx, getItemFromSnbt(item.snbt));
    try {
        await ctx.expectAfter(() => ctx.runCommand("/edit"), itemEditorOpened());
        ctx.getItemSlot("Edit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");

        const leftHasActions = shallowActionListHasActions(
            ctx.getItemSlot("Left Click Actions")
        );
        const rightHasActions = shallowActionListHasActions(
            ctx.getItemSlot("Right Click Actions")
        );
        const result: ExportedClickActions = {};

        if (leftHasActions) {
            ctx.getItemSlot("Left Click Actions").click();
            await timedWaitForMenu(ctx, "menuClickWait");
            const actions = await readOpenActionList(ctx, registry);
            if (actions.length > 0) result.left = actions;
            if (rightHasActions) await clickGoBack(ctx);
        }

        if (rightHasActions) {
            ctx.getItemSlot("Right Click Actions").click();
            await timedWaitForMenu(ctx, "menuClickWait");
            const actions = await readOpenActionList(ctx, registry);
            if (actions.length > 0) result.right = actions;
        }

        return result;
    } finally {
        await restoreTemporarilyHeldItem(ctx, held);
    }
}

function actionReference(snbtReference: string, side: "left" | "right"): string {
    return snbtReference.replace(/\.snbt$/i, `_${side}.htsl`);
}

function actionPath(snbtPath: string, side: "left" | "right"): string {
    return snbtPath.replace(/\.snbt$/i, `_${side}.htsl`);
}

function writeActions(ctx: TaskContext, path: string, actions: readonly Action[]): void {
    const printed = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diagnostic of printed.diagnostics) {
        ctx.displayMessage(`&7[export] &e${diagnostic.message}`);
    }
    ensureParentDirs(path);
    FileLib.write(path, printed.source, true);
    ctx.displayMessage(`&7  -> ${path}`);
}

export async function exportCapturedItems(
    ctx: TaskContext,
    registry: ItemCaptureRegistry,
    rootDir: string,
    importJsonPath: string,
    housingUuid: string,
    newExportTargetImportJson?: string
): Promise<number> {
    if (registry.newEntries().length === 0) return 0;

    const written = new Set<string>();
    for (;;) {
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

    const parsed = readParsedImportablesForExport(importJsonPath);
    if (parsed !== null) {
        const items = createProjectItemIndex(parsed.value, parsed.gcx);
        const dependencies = createItemDependencyIndex(parsed.value, items);
        for (const importable of parsed.value) {
            if (importable.type !== "ITEM" || !written.has(importable.name)) continue;
            let interactionCacheReady = !hasItemClickActions(importable);
            if (!interactionCacheReady) {
                try {
                    const interactData = registry.capturedInteractData(importable.name);
                    if (interactData === null) {
                        throw new Error("captured item has no interact_data");
                    }
                    if (
                        !writeInteractDataCache(
                            importable,
                            dependencies,
                            housingUuid,
                            interactData
                        )
                    ) {
                        throw new Error("write failed");
                    }
                    interactionCacheReady = true;
                } catch (error) {
                    ctx.displayMessage(
                        `&7[export] &eCould not cache click actions for '${importable.name}': ${String(error)}`
                    );
                }
            }
            if (!interactionCacheReady) continue;
            const itemDependencies = dependencies.snapshotOf(importable);
            writeImportableCache(ctx, housingUuid, importable, "exporter", {
                quiet: true,
                itemDependencies,
            });
            upsertHouseLockImportable(
                importJsonPath,
                housingUuid,
                {
                    importable,
                    itemDependencies,
                    itemContent: sourceItemFieldContent(importable, items),
                }
            );
        }
    }

    return written.size;
}
