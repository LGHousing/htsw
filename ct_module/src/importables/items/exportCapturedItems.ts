import * as htsw from "htsw";
import type { Action } from "htsw/types";

import { portableItemSnbt } from "../../housingSync/items/itemNbt";
import { writeImportableCache } from "../../importCache/cache";
import { upsertHouseLockImportable } from "../../importCache/houseLock";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { snbtTargetForItemExport } from "../../project/paths";
import TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import { getItemFromSnbt } from "../../utils/nbt";
import { tagChild } from "../../housingSync/items/itemTag";
import { createItemDependencyIndex } from "./dependencyIndex";
import { createProjectItemIndex } from "./projectItems";
import { readParsedImportablesForExport } from "../export/projectDestination";
import type { ItemCaptureRegistry } from "./captureRegistry";
import { readClickActions } from "./readClickActions";
import { hasItemClickActions, writeInteractDataCache } from "./interactDataCache";
import { sourceItemFieldContent } from "../../housingSync/items/fieldContent";

function actionReference(snbtReference: string, side: "left" | "right"): string {
    return snbtReference.replace(/\.snbt$/i, `_${side}.htsl`);
}

function actionPath(snbtPath: string, side: "left" | "right"): string {
    return snbtPath.replace(/\.snbt$/i, `_${side}.htsl`);
}

function writeActions(
    ctx: TaskContext,
    path: string,
    actions: readonly Action[],
    showProgressMessages: boolean
): void {
    const printed = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diagnostic of printed.diagnostics) {
        ctx.displayMessage(`&7[export] &e${diagnostic.message}`);
    }
    ensureParentDirs(path);
    FileLib.write(path, printed.source, true);
    if (showProgressMessages) ctx.displayMessage(`&7  -> ${path}`);
}

export async function exportCapturedItems(
    ctx: TaskContext,
    registry: ItemCaptureRegistry,
    rootDir: string,
    importJsonPath: string,
    housingUuid: string,
    newExportTargetImportJson?: string,
    showProgressMessages = true
): Promise<number> {
    if (registry.newEntries().length === 0) return 0;

    const written = new Set<string>();
    for (;;) {
        const item = registry.newEntries().find((entry) => !written.has(entry.name));
        if (item === undefined) break;
        written.add(item.name);
        // Custom click actions travel with the stack as interact_data. Plain
        // references (including Housing's protected COOKIE_ITEM) only need
        // their NBT exported; /edit can reject them even in creative mode.
        const nbt = htsw.nbt.parseSnbtText(item.snbt);
        const interactData = tagChild(
            tagChild(tagChild(nbt, "tag"), "ExtraAttributes"),
            "interact_data"
        );
        const actions =
            interactData === undefined
                ? { left: [], right: [] }
                : await readClickActions(
                      ctx,
                      getItemFromSnbt(item.snbt),
                      {
                          itemReadMode: "export",
                          itemCaptures: registry,
                      },
                      undefined,
                      "captured"
                  );
        const target = snbtTargetForItemExport(
            importJsonPath,
            rootDir,
            item.name,
            undefined,
            newExportTargetImportJson
        );
        ensureParentDirs(target.snbtPath);
        FileLib.write(target.snbtPath, portableItemSnbt(item.snbt), true);

        if (actions.left.length > 0) {
            writeActions(
                ctx,
                actionPath(target.snbtPath, "left"),
                actions.left,
                showProgressMessages
            );
        }
        if (actions.right.length > 0) {
            writeActions(
                ctx,
                actionPath(target.snbtPath, "right"),
                actions.right,
                showProgressMessages
            );
        }

        upsertImportableEntry(target.importJsonPath, "items", {
            name: item.name,
            nbt: target.snbtReference,
            ...(actions.left.length > 0
                ? { leftClickActions: actionReference(target.snbtReference, "left") }
                : {}),
            ...(actions.right.length > 0
                ? { rightClickActions: actionReference(target.snbtReference, "right") }
                : {}),
        });
        if (showProgressMessages) ctx.displayMessage(`&7  -> ${target.snbtPath}`);
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
                itemDependencies,
            });
            upsertHouseLockImportable(importJsonPath, housingUuid, {
                importable,
                itemDependencies,
                itemContent: sourceItemFieldContent(importable, items),
            });
        }
    }

    return written.size;
}
