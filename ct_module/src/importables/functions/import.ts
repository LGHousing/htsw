import type { ImportableFunction } from "htsw/types";

import {
    applyActionListPlan,
    prereadActionList,
    type ActionListPlan,
} from "../../importer/actions/sync";
import { clickGoBack } from "../../importer/gui/helpers";
import type { ImportableTrustPlan } from "../../importCache";
import type { ImportEventHandler } from "../../importer/importEvents";
import { createSetupStepEmitter } from "../../importer/progress/setupStepEmitter";
import TaskContext from "../../tasks/context";
import { getActionListTrust, getBaselineActionList } from "../actionListHelpers";
import type { ItemRegistry } from "../itemRegistry";
import {
    countReferencedShells,
    ensureReferencedImportablesExist,
} from "../references";
import {
    ensureFunctionExists,
    openFunctionSettings,
    setAutomaticExecutionTicksIfNeeded,
    setFunctionIconIfNeeded,
} from "./shared";

export type FunctionImportPlan = {
    kind: "FUNCTION";
    importable: ImportableFunction;
    trustPlan?: ImportableTrustPlan;
    actionsPlan: ActionListPlan | null;
};

export async function prereadImportableFunction(
    ctx: TaskContext,
    importable: ImportableFunction,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    events?: ImportEventHandler
): Promise<FunctionImportPlan> {
    const setup = createSetupStepEmitter(events, countReferencedShells(importable) + 1);

    await ensureReferencedImportablesExist(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });
    await ensureFunctionExists(ctx, importable.name);
    setup(`opened function ${importable.name}`);

    const actionsTrusted = trustPlan?.trustedListPaths.has("actions") ?? false;
    if (actionsTrusted) {
        ctx.displayMessage(`&b&l[import] &r&7Function "${importable.name}" trusted, skipped.`);
        return { kind: "FUNCTION", importable, trustPlan, actionsPlan: null };
    }
    ctx.displayMessage(`&b&l[import] &r&bReading function: &f${importable.name} &7(${importable.actions.length} actions)`);
    const actionsPlan = await prereadActionList(ctx, importable.actions, {
        itemRegistry,
        baselineCurrent: getBaselineActionList(trustPlan, "actions"),
        trust: getActionListTrust(trustPlan, "actions"),
        events,
    });
    return { kind: "FUNCTION", importable, trustPlan, actionsPlan };
}

export async function applyImportableFunctionPlan(
    ctx: TaskContext,
    plan: FunctionImportPlan,
    itemRegistry: ItemRegistry,
    events?: ImportEventHandler
): Promise<void> {
    const needsSettings =
        (plan.importable.repeatTicks || plan.importable.icon) &&
        !functionSettingsTrusted(plan.importable, plan.trustPlan);

    if (plan.actionsPlan !== null) {
        await ensureFunctionExists(ctx, plan.importable.name);
        ctx.displayMessage(`&b&l[import] &r&aApplying function: &f${plan.importable.name}`);
        await applyActionListPlan(ctx, plan.actionsPlan, {
            itemRegistry,
            events,
        });
    } else if (needsSettings) {
        await ensureFunctionExists(ctx, plan.importable.name);
    }

    if (needsSettings) {
        await clickGoBack(ctx);
        await openFunctionSettings(ctx, plan.importable.name);
        if (plan.importable.icon) {
            await setFunctionIconIfNeeded(ctx, plan.importable.icon);
        }
        if (plan.importable.repeatTicks) {
            await setAutomaticExecutionTicksIfNeeded(ctx, plan.importable.repeatTicks);
        }
        await clickGoBack(ctx);
    }
}

function functionSettingsTrusted(
    importable: ImportableFunction,
    plan: ImportableTrustPlan | undefined
): boolean {
    if (plan?.entry?.importable.type !== "FUNCTION") {
        return false;
    }
    const cached = plan.entry.importable;
    return (
        cached.repeatTicks === importable.repeatTicks &&
        JSON.stringify(cached.icon ?? null) === JSON.stringify(importable.icon ?? null)
    );
}
