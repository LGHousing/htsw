import type { ImportableFunction } from "htsw/types";

import { syncActionList } from "../../importer/actions/sync";
import { clickGoBack } from "../../importer/gui/helpers";
import type { ImportableTrustPlan } from "../../importCache";
import type { ImportPreviewEventHandler } from "../../importer/importPreviewEvents";
import TaskContext from "../../tasks/context";
import { getActionListTrust, getBaselineActionList } from "../actionListHelpers";
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
    trustPlan?: ImportableTrustPlan,
    previewHandler?: ImportPreviewEventHandler
): Promise<void> {
    await ensureReferencedImportablesExist(ctx, importable);
    await ensureFunctionExists(ctx, importable.name);

    const actionsTrusted = trustPlan?.trustedListPaths.has("actions") ?? false;
    if (!actionsTrusted) {
        ctx.displayMessage(`&b&l[import] &r&bSyncing function: &f${importable.name} &7(${importable.actions.length} actions)`);
        await syncActionList(ctx, importable.actions, {
            itemRegistry,
            baselineCurrent: getBaselineActionList(trustPlan, "actions"),
            trust: getActionListTrust(trustPlan, "actions"),
            previewHandler,
        });
    } else {
        ctx.displayMessage(`&b&l[import] &r&7Function "${importable.name}" trusted, skipped.`);
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
