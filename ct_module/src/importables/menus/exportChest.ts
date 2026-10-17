import { emitBridgeEvent } from "../../bridge/status";
import type { ImportableItem } from "htsw/types";

import { portableItemSnbt, snbtFromItem } from "../../housingSync/items/itemNbt";
import { ItemCaptureRegistry } from "../items/captureRegistry";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { importJsonTargetForSectionEntry, parentDirOf } from "../../project/paths";
import { ensureParentDirs, readTextFileOrNull } from "../../utils/filesystem";
import { removedFormatting } from "../../utils/helpers";

type CapturedChestSlot = {
    slot: number;
    snbt: string;
    nameHint: string;
};

export type CapturedChest = {
    totalSlots: number;
    slots: CapturedChestSlot[];
};

export type ChestExportOptions = {
    name: string;
    importJsonPath: string;
    rootDir: string;
    projectItems: readonly ImportableItem[];
    newExportTargetImportJson?: string;
    showProgressMessages?: boolean;
};

export type ChestExportCounts = {
    populatedSlots: number;
    newItemsWritten: number;
    matchedExisting: number;
};

export type ExportMessageSink = {
    displayMessage(message: string): void;
};

type RegisteredChestSlot = {
    slot: number;
    itemName: string;
};

type ChestMenuEntry = {
    name: string;
    size?: number;
    slots: Array<{ slot: number; nbt: string }>;
};

export function buildChestMenuEntry(
    name: string,
    totalSlots: number,
    slots: readonly RegisteredChestSlot[]
): ChestMenuEntry {
    return {
        name,
        ...(totalSlots % 9 === 0 ? { size: totalSlots / 9 } : {}),
        slots: slots.map((entry) => ({
            slot: entry.slot,
            nbt: `items/${entry.itemName}.snbt`,
        })),
    };
}

export function captureOpenChest(): CapturedChest | null {
    const container = Player.getContainer();
    if (container === undefined) return null;
    if (container.getClassName().indexOf("ContainerChest") === -1) return null;

    const totalSlots = container.getSize() - 36;
    if (totalSlots <= 0) return null;
    if (totalSlots > 54) {
        throw new Error(`Open chest has ${totalSlots} slots; at most 54 are supported.`);
    }

    const slots: CapturedChestSlot[] = [];
    for (let slot = 0; slot < totalSlots; slot++) {
        const stack = container.getStackInSlot(slot);
        if (stack === null) continue;
        const snbt = snbtFromItem(stack, { pretty: false });
        slots.push({
            slot,
            snbt,
            nameHint: removedFormatting(stack.getName()).trim(),
        });
    }

    return { totalSlots, slots };
}

export async function exportCapturedChest(
    sink: ExportMessageSink,
    captured: CapturedChest,
    options: ChestExportOptions
): Promise<ChestExportCounts> {
    const importJsonPath = importJsonTargetForSectionEntry(
        options.importJsonPath,
        "menus",
        options.name,
        options.newExportTargetImportJson
    );
    const rootDir =
        importJsonPath === options.importJsonPath
            ? options.rootDir
            : parentDirOf(importJsonPath);
    const registry = new ItemCaptureRegistry("shell", {
        existingSnbt: (name) => readTextFileOrNull(`${rootDir}/items/${name}.snbt`),
    });
    for (let i = 0; i < options.projectItems.length; i++) {
        registry.seedNbtOnly(options.projectItems[i].name, options.projectItems[i].nbt);
    }
    const writtenItems = new Set<string>();
    const registeredSlots: RegisteredChestSlot[] = [];

    for (let i = 0; i < captured.slots.length; i++) {
        const slot = captured.slots[i];
        const itemName = registry.register(slot.snbt, slot.nameHint);
        const nbtRel = `items/${itemName}.snbt`;
        const itemAbs = `${rootDir}/${nbtRel}`;
        if (!writtenItems.has(itemAbs)) {
            ensureParentDirs(itemAbs);
            FileLib.write(itemAbs, portableItemSnbt(slot.snbt), true);
            writtenItems.add(itemAbs);
        }
        registeredSlots.push({ slot: slot.slot, itemName });
    }

    upsertImportableEntry(
        importJsonPath,
        "menus",
        buildChestMenuEntry(options.name, captured.totalSlots, registeredSlots)
    );

    const itemCounts = registry.counts();
    emitBridgeEvent("htsw_export", {
        status: "completed",
        count: captured.slots.length,
        path: importJsonPath,
        name: options.name,
        newItemsWritten: itemCounts.fresh,
        matchedExisting: itemCounts.matched,
    });
    const hints = registry.takeHints();
    for (let i = 0; i < hints.length; i++) {
        sink.displayMessage(`&e[export] ${hints[i]}`);
    }
    if (options.showProgressMessages !== false) {
        sink.displayMessage(
            `&aExported menu '${options.name}' (${captured.slots.length} slot${captured.slots.length === 1 ? "" : "s"}, items: ${itemCounts.matched} matched, ${itemCounts.fresh} new)`
        );
        sink.displayMessage(`&7  -> ${importJsonPath}`);
    }

    return {
        populatedSlots: captured.slots.length,
        newItemsWritten: itemCounts.fresh,
        matchedExisting: itemCounts.matched,
    };
}
