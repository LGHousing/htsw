import type { Action, Importable, ImportableFunction } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/applyDiff";
import {
    actionsFullyHydrated,
    type ActionListPlan,
} from "../../housingSync/actions/plan";
import { clickGoBack } from "../../housingSync/gui/menuUtils";
import { timedWaitForMenu } from "../../housingSync/gui/menuWait";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/progress/setupStepEmitter";
import TaskContext from "../../tasks/context";
import {
    hasTrustedActionListBaseline,
    prereadActionListUsingTrust,
} from "../actionListHelpers";
import type { ImportSession } from "../imports";
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
     * True when icon/tick settings need no further work. When false, the apply
     * pass opens the settings menu after all prereads have succeeded.
     */
    settingsHandled: boolean;
};

export async function prereadImportableFunction(
    ctx: TaskContext,
    importable: ImportableFunction,
    session: ImportSession,
    trustPlan?: ImportableTrustPlan
): Promise<FunctionImportPlan> {
    const setup = createSetupStepEmitter(session.events, countReferencedShells(importable) + 1);

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

    if (hasTrustedActionListBaseline(trustPlan, "actions")) {
        setup(`planned ${importable.name} from cache`);
        const actionsPlan = await prereadActionListUsingTrust(ctx, importable.actions, {
            session,
            trustPlan,
            basePath: "actions",
        });

        return {
            kind: "FUNCTION",
            importable,
            trustPlan,
            actionsPlan,
            settingsHandled: settingsTrusted,
        };
    }

    await ensureFunctionExists(ctx, importable.name);
    setup(`opened function ${importable.name}`);
    const actionsPlan = await prereadActionListUsingTrust(ctx, importable.actions, {
        session,
        trustPlan,
        basePath: "actions",
    });

    return {
        kind: "FUNCTION",
        importable,
        trustPlan,
        actionsPlan,
        settingsHandled: settingsTrusted,
    };
}

export async function applyImportableFunctionPlan(
    ctx: TaskContext,
    plan: FunctionImportPlan,
    session: ImportSession
): Promise<void> {
    const needsSettings = !plan.settingsHandled;

    if (plan.actionsPlan !== null) {
        await ensureFunctionExists(ctx, plan.importable.name);
        await applyActionListPlan(ctx, plan.actionsPlan, {
            session,
        });
        if (needsSettings) {
            await functionImportStep(
                `leaving action editor for function ${plan.importable.name}`,
                () => clickGoBack(ctx)
            );
        }
    }

    if (needsSettings) {
        if (plan.actionsPlan === null) {
            await ctx.runCommand(`/functions`);
            await timedWaitForMenu(ctx, "commandMenuWait");
        }
        await functionImportStep(
            `opening settings for function ${plan.importable.name}`,
            () => openFunctionSettings(ctx, plan.importable.name)
        );
        await applyFunctionSettings(ctx, plan.importable);
    }
}

async function functionImportStep<T>(
    label: string,
    run: () => Promise<T>
): Promise<T> {
    try {
        return await run();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${label}: ${message}`);
    }
}

/**
 * True when applying this plan changes nothing — its action diff is empty and
 * icon/ticks are already handled — so the apply pass can be skipped.
 */
export function functionPlanIsNoOp(plan: FunctionImportPlan): boolean {
    const actionsNoOp =
        plan.actionsPlan === null || plan.actionsPlan.diff.operations.length === 0;
    return actionsNoOp && plan.settingsHandled;
}

export function reconstructPartialFunction(plan: FunctionImportPlan): Importable | null {
    const live = plan.actionsPlan?.getLiveCurrent?.();
    if (live === undefined || !actionsFullyHydrated(live)) return null;
    return { type: "FUNCTION", name: plan.importable.name, actions: live as Action[] };
}

function functionSettingsTrusted(
    importable: ImportableFunction,
    plan: ImportableTrustPlan | undefined
): boolean {
    if (plan?.trustMode !== true || plan.entry?.importable.type !== "FUNCTION") {
        return false;
    }
    const cached = plan.entry.importable;
    return (
        cached.repeatTicks === importable.repeatTicks &&
        JSON.stringify(cached.icon ?? null) === JSON.stringify(importable.icon ?? null)
    );
}
