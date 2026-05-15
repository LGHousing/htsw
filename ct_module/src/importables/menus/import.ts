import type { ImportableMenu } from "htsw/types";

import { syncActionList } from "../../importer/actions/sync";
import {
    clickGoBack,
    setCycleValue,
    timedWaitForMenu,
    timedWaitForUnformattedMessage,
} from "../../importer/gui/helpers";
import { selectItemFromOpenInventory } from "../../importer/items/items";
import type { ImportableTrustPlan } from "../../knowledge";
import type { ActionListProgressFields } from "../../importer/progress/types";
import TaskContext from "../../tasks/context";
import { getItemFromNbt } from "../../utils/nbt";
import { actionListTrustFor } from "../actionListTrust";
import type { ItemRegistry } from "../itemRegistry";
import { ensureReferencedImportablesExist } from "../references";
import { openMenuEditor } from "./shared";

const MENU_SIZE_OPTIONS = ["1", "2", "3", "4", "5", "6"];

export async function importImportableMenu(
    ctx: TaskContext,
    importable: ImportableMenu,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    onActionListProgress?: (progress: ActionListProgressFields) => void
): Promise<void> {
    await ensureReferencedImportablesExist(ctx, importable);

    const alreadyExists = (await openMenuEditor(ctx, importable.name)) === "opened";

    if (!alreadyExists) {
        await ctx.runCommand(`/menu create ${importable.name}`);
        await timedWaitForUnformattedMessage(ctx, `Created menu ${importable.name}!`);

        await openMenuEditor(ctx, importable.name);
    }

    if (importable.size !== undefined && !menuTopLevelTrusted(importable, trustPlan)) {
        await setCycleValue(
            ctx,
            "Change Size",
            MENU_SIZE_OPTIONS,
            String(importable.size)
        );
    }

    for (let i = 0; i < importable.slots.length; i++) {
        const slot = importable.slots[i];
        const item = getItemFromNbt(slot.nbt);

        const container = Player.getContainer();
        if (container == null) {
            throw new Error("No open container while opening menu slot " + slot.slot);
        }
        container.click(slot.slot, false, "LEFT");
        await timedWaitForMenu(ctx, "menuClickWait");

        await selectItemFromOpenInventory(ctx, item, `menu slot ${slot.slot}`);

        const slotActionsPath = `slots[${i}].actions`;
        const hasActions = slot.actions !== undefined && slot.actions.length > 0;
        const slotActionsTrusted =
            trustPlan?.trustedListPaths.has(slotActionsPath) ?? false;

        if (hasActions && !slotActionsTrusted) {
            ctx.getItemSlot("Edit Actions").click();
            await timedWaitForMenu(ctx, "menuClickWait");

            await syncActionList(ctx, slot.actions!, {
                itemRegistry,
                trust: actionListTrustFor(trustPlan, slotActionsPath, slot.actions!),
                onProgress: onActionListProgress,
            });

            await clickGoBack(ctx);
        }

        await clickGoBack(ctx);
    }
}

function menuTopLevelTrusted(
    importable: ImportableMenu,
    plan: ImportableTrustPlan | undefined
): boolean {
    if (plan?.entry?.importable.type !== "MENU") {
        return false;
    }
    return plan.entry.importable.size === importable.size;
}
