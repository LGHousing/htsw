import type { ImportableItem } from "htsw/types";

import {
    ItemCaptureRegistry,
    portableItemSnbt,
    snbtFromItem,
} from "../../housingSync/itemCapture";
import { isUnspawnableItem } from "../../housingSync/items/unspawnableItems";
import { selectedHotbarSlot } from "../../housingSync/menus/packets";
import { importJsonTargetForSectionEntry } from "../../project/paths";
import {
    resolveImportableFile,
    updateImportableField,
} from "../../project/importJsonMutations";
import type { ReadFn, ReadOptions, ReadResult } from "../read";
import type TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/manager";
import { getItemFromNbt } from "../../utils/nbt";
import { removedFormatting } from "../../utils/helpers";
import {
    injectHeldItem,
    restoreHeldItemInjectionSlot,
    snapshotHeldItemInjectionSlot,
} from "./heldItem";
import { itemIdFromNbt, itemNbtHasInteractData } from "./exportLogic";
import { actionPath, readHeldClickActions, writeActions } from "./clickActionsExport";
import { writeCapturedItems } from "./writeCapturedItems";

function seededRegistry(items: readonly ImportableItem[] | undefined): ItemCaptureRegistry {
    const registry = new ItemCaptureRegistry();
    for (const item of items ?? []) registry.seed(item.name, item.nbt);
    return registry;
}

function relativePath(fromJsonPath: string, targetPath: string): string {
    const Paths = Java.type("java.nio.file.Paths");
    const from = Paths.get(String(fromJsonPath)).toAbsolutePath().normalize().getParent();
    const target = Paths.get(String(targetPath)).toAbsolutePath().normalize();
    return String(from.relativize(target).toString()).split("\\").join("/");
}

export function declaredItemActionCandidates(options: ReadOptions): {
    candidates: ImportableItem[];
    unspawnable: Array<{ item: ImportableItem; itemId: string }>;
} {
    const names = options.names === undefined ? null : new Set(options.names);
    const candidates: ImportableItem[] = [];
    const unspawnable: Array<{ item: ImportableItem; itemId: string }> = [];
    for (const item of options.projectItems ?? []) {
        if (!itemNbtHasInteractData(item.nbt) || (names !== null && !names.has(item.name))) continue;
        const itemId = itemIdFromNbt(item.nbt);
        if (itemId !== null && isUnspawnableItem(itemId)) {
            unspawnable.push({ item, itemId });
        } else {
            candidates.push(item);
        }
    }
    return { candidates, unspawnable };
}

export const exportHeldItem: ReadFn = async (ctx, options) => {
    const slotId = selectedHotbarSlot();
    const stack = Player.getInventory()?.getStackInSlot(slotId);
    if (stack === null || stack === undefined) {
        throw new Error("Please hold the item you wish to export!");
    }
    const snbt = snbtFromItem(stack, { pretty: false });
    if (snbt === null) throw new Error("Could not read the held item's NBT.");

    const registry = seededRegistry(options.projectItems);
    const name = registry.register(snbt, removedFormatting(stack.getName()).trim() || "item", slotId);
    if (!registry.needsWrite(name)) {
        ctx.displayMessage(`&7[export] Held item is already declared as '${name}'.`);
        return { total: 1, succeeded: 1, failed: 0 };
    }
    await writeCapturedItems(
        ctx,
        registry,
        options.rootDir,
        options.importJsonPath,
        options.newExportTargetImportJson
    );
    return { total: 1, succeeded: 1, failed: 0 };
};

async function exportDeclaredItem(
    ctx: TaskContext,
    options: ReadOptions,
    item: ImportableItem,
    registry: ItemCaptureRegistry
): Promise<void> {
    const snbtPath = resolveImportableFile(options.importJsonPath, "items", item.name);
    await injectHeldItem(ctx, getItemFromNbt(item.nbt));
    const actions = await readHeldClickActions(ctx, registry);
    const declaringJson = importJsonTargetForSectionEntry(options.importJsonPath, "items", item.name);

    for (const side of ["left", "right"] as const) {
        const sideActions = actions[side];
        if (sideActions === undefined) continue;
        const path = actionPath(snbtPath, side);
        writeActions(ctx, path, sideActions);
        const field = side === "left" ? "leftClickActions" : "rightClickActions";
        if (!updateImportableField(declaringJson, "items", item.name, field, relativePath(declaringJson, path))) {
            throw new Error(`Could not attach ${field} to '${item.name}'.`);
        }
    }

    const raw = FileLib.read(snbtPath);
    if (raw !== null) {
        FileLib.write(snbtPath, portableItemSnbt(String(raw)), true);
        ctx.displayMessage(`&7  -> ${snbtPath}`);
    }
}

export const exportDeclaredItemActions: ReadFn = async (ctx, options): Promise<ReadResult> => {
    const selection = declaredItemActionCandidates(options);
    const { candidates } = selection;
    const progress = options.progress;
    const registry = seededRegistry(options.projectItems);
    const snapshot = snapshotHeldItemInjectionSlot();
    let succeeded = 0;
    let failed = 0;
    for (const skipped of selection.unspawnable) {
        ctx.displayMessage(
            `&7[export] Skipping unspawnable item '${skipped.item.name}' (${skipped.itemId}).`
        );
    }
    progress?.start(candidates.map((item) => item.name));
    try {
        for (let i = 0; i < candidates.length; i++) {
            const item = candidates[i];
            ctx.checkCancelled();
            progress?.item(i, item.name);
            try {
                await exportDeclaredItem(ctx, options, item, registry);
                succeeded++;
                progress?.itemFinished?.(i);
            } catch (error) {
                if (isTaskCancelled(error)) throw error;
                failed++;
                progress?.itemFailed?.(i, String(error));
                ctx.displayMessage(`&c[export] failed on item '${item.name}': ${error}`);
            }
        }
    } finally {
        progress?.done();
        try {
            await writeCapturedItems(
                ctx,
                registry,
                options.rootDir,
                options.importJsonPath,
                options.newExportTargetImportJson
            );
        } finally {
            await restoreHeldItemInjectionSlot(ctx, snapshot);
        }
    }
    return { total: candidates.length, succeeded, failed };
};
