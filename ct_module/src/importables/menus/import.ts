import type { ImportableMenu } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/applyDiff";
import { prereadActionList } from "../../housingSync/actions/plan";
import { clickGoBack, setCycleValue } from "../../housingSync/gui/menuUtils";
import {
    timedWaitForMenu,
    timedWaitForUnformattedMessage,
} from "../../housingSync/gui/menuWait";
import { selectItemFromOpenInventory } from "../../housingSync/items/injectItem";
import type { ImportableTrustPlan } from "../../importCache";
import type { ImportEventHandler } from "../../housingSync/importEvents";
import { createSetupStepEmitter } from "../../housingSync/progress/setupStepEmitter";
import TaskContext from "../../tasks/context";
import { getItemFromNbt } from "../../utils/nbt";
import { getActionListTrust, getBaselineActionList } from "../actionListHelpers";
import type { ItemRegistry } from "../itemRegistry";
import {
    countReferencedShells,
    ensureReferencedImportablesExist,
} from "../references";
import { openMenuEditor } from "./shared";

const MENU_SIZE_OPTIONS = ["1", "2", "3", "4", "5", "6"];

export type MenuImportPlan = {
    kind: "MENU";
    importable: ImportableMenu;
    trustPlan?: ImportableTrustPlan;
};

export async function prereadImportableMenu(
    _ctx: TaskContext,
    importable: ImportableMenu,
    _itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    _events?: ImportEventHandler
): Promise<MenuImportPlan> {
    return { kind: "MENU", importable, trustPlan };
}

export async function applyImportableMenuPlan(
    ctx: TaskContext,
    plan: MenuImportPlan,
    itemRegistry: ItemRegistry,
    events?: ImportEventHandler
): Promise<void> {
    await importImportableMenu(
        ctx,
        plan.importable,
        itemRegistry,
        plan.trustPlan,
        events
    );
}

async function importImportableMenu(
    ctx: TaskContext,
    importable: ImportableMenu,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    events?: ImportEventHandler
): Promise<void> {
    const setup = createSetupStepEmitter(events, countReferencedShells(importable) + 1);

    await ensureReferencedImportablesExist(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const alreadyExists = (await openMenuEditor(ctx, importable.name)) === "opened";

    if (!alreadyExists) {
        await ctx.runCommand(`/menu create ${importable.name}`);
        await timedWaitForUnformattedMessage(ctx, `Created menu ${importable.name}!`);

        await openMenuEditor(ctx, importable.name);
    }
    setup(`opened menu ${importable.name}`);

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

            const actionsPlan = await prereadActionList(ctx, slot.actions!, {
                itemRegistry,
                baselineCurrent: getBaselineActionList(trustPlan, slotActionsPath),
                trust: getActionListTrust(trustPlan, slotActionsPath),
                events,
            });
            await applyActionListPlan(ctx, actionsPlan, { itemRegistry, events });

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
