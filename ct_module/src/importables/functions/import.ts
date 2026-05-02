import type { ImportableFunction } from "htsw/types";

import { syncActionList } from "../../importer/actions";
import { clickGoBack } from "../../importer/helpers";
import type { ImportableTrustPlan } from "../../knowledge";
import TaskContext from "../../tasks/context";
import { actionListTrustFor } from "../actionListTrust";
import type { ItemRegistry } from "../itemRegistry";
import { ensureReferencedImportablesExist } from "../references";
import {
    ensureFunctionExists,
    openFunctionSettings,
    setAutomaticExecutionTicksIfNeeded,
    setFunctionIconIfNeeded,
} from "./shared";

export async function importImportableFunction(
    ctx: TaskContext,
    importable: ImportableFunction,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan
): Promise<void> {
    await ensureReferencedImportablesExist(ctx, importable);
    await ensureFunctionExists(ctx, importable.name);

    const actionsTrust = actionListTrustFor(trustPlan, "actions", importable.actions);
    const actionsTrusted =
        actionsTrust !== undefined && trustPlan?.trustedListPaths.has("actions");
    if (!actionsTrusted) {
        await syncActionList(ctx, importable.actions, {
            itemRegistry,
            trust: actionsTrust,
        });
    }

    if (
        (importable.repeatTicks || importable.icon) &&
        !functionSettingsTrusted(importable, trustPlan)
    ) {
        await clickGoBack(ctx);

        await openFunctionSettings(ctx, importable.name);
        if (importable.icon) {
            await setFunctionIconIfNeeded(ctx, importable.icon);
        }
        if (importable.repeatTicks) {
            await setAutomaticExecutionTicksIfNeeded(ctx, importable.repeatTicks);
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
