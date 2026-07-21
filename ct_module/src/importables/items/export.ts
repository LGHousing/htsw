import { snbtFromItem } from "../../housingSync/items/itemNbt";
import {
    restorePlayerInventory,
    snapshotPlayerInventory,
} from "../../housingSync/items/playerInventory";
import { getCurrentHousingUuid } from "../../importCache/housingId";
import { selectedHotbarSlot } from "../../housingSync/menus/packets";
import type { ReadFn } from "../read";
import { removedFormatting } from "../../utils/helpers";
import { exportCapturedItems } from "./exportCapturedItems";
import { createExportItemCaptureRegistry } from "../exportContext";

export const exportHeldItem: ReadFn = async (ctx, options) => {
    const slotId = selectedHotbarSlot();
    const stack = Player.getInventory()?.getStackInSlot(slotId);
    if (stack === null || stack === undefined) {
        throw new Error("Please hold the item you wish to export!");
    }
    const snbt = snbtFromItem(stack, { pretty: false });

    const housingUuid = await getCurrentHousingUuid(ctx);
    const registry = createExportItemCaptureRegistry(
        options.importJsonPath,
        housingUuid,
        options.projectItems
    );
    const name = registry.register(
        snbt,
        removedFormatting(stack.getName()).trim() || "item"
    );
    if (!registry.needsWrite(name)) {
        ctx.displayMessage(`&7[export] Held item is already declared as '${name}'.`);
        return { total: 1, succeeded: 1, failed: 0 };
    }
    const inventorySnapshot = snapshotPlayerInventory();
    try {
        await exportCapturedItems(
            ctx,
            registry,
            options.rootDir,
            options.importJsonPath,
            housingUuid,
            options.newExportTargetImportJson
        );
    } finally {
        await restorePlayerInventory(ctx, inventorySnapshot);
    }
    return { total: 1, succeeded: 1, failed: 0 };
};
