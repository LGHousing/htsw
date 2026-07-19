import {
    snbtFromItem,
} from "../../housingSync/itemCapture";
import { getCurrentHousingUuid } from "../../importCache/housingId";
import { selectedHotbarSlot } from "../../housingSync/menus/packets";
import type { ReadFn } from "../read";
import { removedFormatting } from "../../utils/helpers";
import { writeCapturedItems } from "./writeCapturedItems";
import { createExportItemCaptureRegistry } from "../exportContext";

export const exportHeldItem: ReadFn = async (ctx, options) => {
    const slotId = selectedHotbarSlot();
    const stack = Player.getInventory()?.getStackInSlot(slotId);
    if (stack === null || stack === undefined) {
        throw new Error("Please hold the item you wish to export!");
    }
    const snbt = snbtFromItem(stack, { pretty: false });
    if (snbt === null) throw new Error("Could not read the held item's NBT.");

    const housingUuid = await getCurrentHousingUuid(ctx);
    const registry = createExportItemCaptureRegistry(
        options.importJsonPath,
        housingUuid,
        options.projectItems
    );
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
        housingUuid,
        options.newExportTargetImportJson
    );
    return { total: 1, succeeded: 1, failed: 0 };
};
