import type { ImportableFunction } from "htsw/types";

import {
    applyActionListPlan,
    prereadActionList,
    type ActionListPlan,
} from "../../housingSync/actions/sync";
import { clickGoBack } from "../../housingSync/gui/menuUtils";
import { timedWaitForMenu } from "../../housingSync/gui/menuWait";
import type { ImportableTrustPlan } from "../../importCache";
import type { ImportEventHandler } from "../../housingSync/importEvents";
import { createSetupStepEmitter } from "../../housingSync/progress/setupStepEmitter";
import TaskContext from "../../tasks/context";
import { getActionListTrust, getBaselineActionList } from "../actionListHelpers";
import type { ItemRegistry } from "../itemRegistry";
import {
    countReferencedShells,
    ensureReferencedImportablesExist,
} from "../references";
import {
    applyFunctionSettings,
    ensureFunctionExists,
    ensureFunctionNamesExist,
    functionIconMatches,
    openFunctionSettings,
} from "./shared";

export type FunctionImportPlan = {
    kind: "FUNCTION";
    importable: ImportableFunction;
    trustPlan?: ImportableTrustPlan;
    actionsPlan: ActionListPlan | null;
    /**
     * True when the icon/tick settings need no further work — either trusted,
     * or already applied inline during preread (which happens when the action
     * diff was empty). When true, the apply pass skips the settings menu.
     */
    settingsHandled: boolean;
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

    const actionsTrusted = trustPlan?.trustedListPaths.has("actions") ?? false;
    const settingsTrusted = functionSettingsTrusted(importable, trustPlan);

    if (actionsTrusted && settingsTrusted) {
        setup(`skipped ${importable.name}`);
        return { kind: "FUNCTION", importable, trustPlan, actionsPlan: null, settingsHandled: true };
    }

    if (actionsTrusted) {
        setup(`settings-only ${importable.name}`);
        return { kind: "FUNCTION", importable, trustPlan, actionsPlan: null, settingsHandled: false };
    }

    // Icon-only entry: no `actions` declared in import.json. NEVER diff/sync
    // the action list — syncing against an empty list would delete every live
    // action. Crucially, also DON'T open the function's action editor here
    // (via /function edit): for a bulk icon import over hundreds of functions
    // that opens a heavy paginated GUI per function and hangs on big ones.
    // The session-cached name list confirms/creates existence with no editor
    // open, and the apply pass sets the icon straight from /functions →
    // settings.
    if (importable.actions === undefined) {
        await ensureFunctionNamesExist(ctx, [importable.name]);
        // The icon is the only settable thing for an icon-only entry, and it's
        // readable straight from the /functions list we just cached — confirm a
        // match here so an unchanged icon skips the apply pass entirely (no
        // settings menu, no item placement). repeatTicks isn't visible in that
        // list, so an entry that pins it still needs the apply pass.
        const settingsHandled =
            settingsTrusted ||
            (importable.repeatTicks === undefined && (await functionIconMatches(ctx, importable)));
        setup(
            settingsHandled
                ? `skipped ${importable.name}`
                : `settings-only ${importable.name}`
        );
        return { kind: "FUNCTION", importable, trustPlan, actionsPlan: null, settingsHandled };
    }

    await ensureFunctionExists(ctx, importable.name);
    setup(`opened function ${importable.name}`);
    const actionsPlan = await prereadActionList(ctx, importable.actions, {
        itemRegistry,
        baselineCurrent: getBaselineActionList(trustPlan, "actions"),
        trust: getActionListTrust(trustPlan, "actions"),
        events,
    });

    // When the actions already match, the only work left is icon/ticks. We're
    // one go-back from the settings menu, so just apply them now (the setters
    // short-circuit when unchanged) and let pass 2 skip this function entirely.
    // Skipped when the diff is non-empty — pass 2 visits settings anyway, so a
    // first import (everything changes) pays no extra round trip here.
    let settingsHandled = settingsTrusted;
    if (!settingsHandled && actionsPlan.diff.operations.length === 0) {
        await clickGoBack(ctx); // actions editor -> function list
        await openFunctionSettings(ctx, importable.name);
        await applyFunctionSettings(ctx, importable);
        await clickGoBack(ctx); // settings -> function list
        settingsHandled = true;
    }

    return { kind: "FUNCTION", importable, trustPlan, actionsPlan, settingsHandled };
}

export async function applyImportableFunctionPlan(
    ctx: TaskContext,
    plan: FunctionImportPlan,
    itemRegistry: ItemRegistry,
    events?: ImportEventHandler
): Promise<void> {
    const needsSettings = !plan.settingsHandled;

    if (plan.actionsPlan !== null) {
        await ensureFunctionExists(ctx, plan.importable.name);
        await applyActionListPlan(ctx, plan.actionsPlan, {
            itemRegistry,
            events,
        });
        if (needsSettings) {
            await clickGoBack(ctx);
        }
    }

    if (needsSettings) {
        if (plan.actionsPlan === null) {
            await ctx.runCommand(`/functions`);
            await timedWaitForMenu(ctx, "commandMenuWait");
        }
        await openFunctionSettings(ctx, plan.importable.name);
        await applyFunctionSettings(ctx, plan.importable);
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
