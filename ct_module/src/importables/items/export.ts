import type { ImportableItem } from "htsw/types";

import {
    ItemCaptureRegistry,
    snbtFromItem,
} from "../../housingSync/itemCapture";
import { selectedHotbarSlot } from "../../housingSync/menus/packets";
import type { ReadFn } from "../read";
import { removedFormatting } from "../../utils/helpers";
import { writeCapturedItems } from "./writeCapturedItems";

function seededRegistry(items: readonly ImportableItem[] | undefined): ItemCaptureRegistry {
    const registry = new ItemCaptureRegistry();
    for (const item of items ?? []) registry.seed(item.name, item.nbt);
    return registry;
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
