import type { Action, Importable, ImportableFunction } from "htsw/types";

import {
    applyActionListPlan,
    type ActionListApplyResult,
} from "../../housingSync/actions/apply";
import {
    actionsFullyHydrated,
    type ActionListPlan,
} from "../../housingSync/actions/plan";
import { prepareActionListSync } from "../../housingSync/actions/prepareSync";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
import TaskContext from "../../tasks/context";
import type { ImportSession } from "../imports";
import { createMissingReferencedShells } from "../references";
import { countReferencedShells } from "../referenceScanner";
import { functionListOpened } from "../waiters";
import {
    applyFunctionSettings,
    ensureFunctionExists,
    ensureFunctionNamesExist,
    functionIconMatches,
    openFunctionSettings,
    readAutomaticExecutionTicks,
} from "./shared";

export type FunctionImportPlan = {
    kind: "FUNCTION";
    importable: ImportableFunction;
    trustPlan?: ImportableTrustPlan;
    actionsPlan: ActionListPlan | null;
    settingsPlan: FunctionSettingsPlan | null;
};

type FunctionSettingsPlan = {
    iconNeedsApply: boolean;
    automaticExecution: {
        current: number;
        desired: number;
        needsApply: boolean;
    };
};

export async function prereadImportableFunction(
    ctx: TaskContext,
    importable: ImportableFunction,
    session: ImportSession,
    trustPlan?: ImportableTrustPlan
): Promise<FunctionImportPlan> {
    const setup = createSetupStepEmitter(session.events, countReferencedShells(importable) + 1);

    await createMissingReferencedShells(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const settingsTrusted = functionSettingsTrusted(importable, trustPlan);

    const actionsSync = await prepareActionListSync(ctx, {
        desired: importable.actions,
        session,
        trustPlan,
        basePath: "actions",
        open: async () => {
            await ensureFunctionExists(ctx, importable.name);
            setup(`opened function ${importable.name}`);
        },
    });

    if (actionsSync.kind === "skipped" && actionsSync.reason === "trusted" && settingsTrusted) {
        setup(`skipped ${importable.name}`);
        return { kind: "FUNCTION", importable, trustPlan, actionsPlan: null, settingsPlan: null };
    }

    if (actionsSync.kind === "skipped" && actionsSync.reason === "trusted") {
        await openFunctionList(ctx);
        const settingsPlan = await readFunctionSettingsPlan(ctx, importable);
        setup(
            functionSettingsPlanNeedsApply(settingsPlan)
                ? `settings-only ${importable.name}`
                : `skipped ${importable.name}`
        );
        return { kind: "FUNCTION", importable, trustPlan, actionsPlan: null, settingsPlan };
    }

    // Icon-only entry: no `actions` declared in import.json. NEVER diff/sync
    // the action list — syncing against an empty list would delete every live
    // action. Crucially, also DON'T open the function's action editor here
    // (via /function edit): for a bulk icon import over hundreds of functions
    // that opens a heavy paginated GUI per function and hangs on big ones.
    // The session-cached name list confirms/creates existence with no editor
    // open, and the apply pass sets the icon straight from /functions →
    // settings.
    if (actionsSync.kind === "skipped" && actionsSync.reason === "undeclared") {
        await ensureFunctionNamesExist(ctx, [importable.name]);
        const settingsPlan = settingsTrusted
            ? null
            : await readFunctionSettingsPlan(ctx, importable);
        setup(
            functionSettingsPlanNeedsApply(settingsPlan)
                ? `settings-only ${importable.name}`
                : `skipped ${importable.name}`
        );
        return { kind: "FUNCTION", importable, trustPlan, actionsPlan: null, settingsPlan };
    }

    if (actionsSync.kind !== "planned") {
        throw new Error(`Unexpected action-list sync skip for function ${importable.name}.`);
    }

    const settingsPlan = settingsTrusted
        ? null
        : await readFunctionSettingsPlanAfterActionEditor(ctx, importable);

    return {
        kind: "FUNCTION",
        importable,
        trustPlan,
        actionsPlan: actionsSync.plan,
        settingsPlan,
    };
}

export async function applyImportableFunctionPlan(
    ctx: TaskContext,
    plan: FunctionImportPlan,
    session: ImportSession
): Promise<void> {
    if (functionSettingsPlanNeedsApply(plan.settingsPlan)) {
        await openFunctionList(ctx);
        await functionImportStep(
            `opening settings for function ${plan.importable.name}`,
            () => openFunctionSettings(ctx, plan.importable.name)
        );
        await applyFunctionSettings(ctx, plan.importable);
    }

    if (plan.actionsPlan !== null) {
        await ensureFunctionExists(ctx, plan.importable.name);
        await applyActionListPlan(ctx, plan.actionsPlan, {
            session,
        });
    }
}

async function openFunctionList(ctx: TaskContext): Promise<void> {
    await ctx.expectAfter(
        () => ctx.runCommand("/functions"),
        functionListOpened()
    );
}

async function readFunctionSettingsPlanAfterActionEditor(
    ctx: TaskContext,
    importable: ImportableFunction
): Promise<FunctionSettingsPlan> {
    await clickGoBack(ctx);
    return readFunctionSettingsPlan(ctx, importable);
}

async function readFunctionSettingsPlan(
    ctx: TaskContext,
    importable: ImportableFunction
): Promise<FunctionSettingsPlan> {
    const iconNeedsApply = !(await functionIconMatches(ctx, importable));
    await openFunctionSettings(ctx, importable.name);
    try {
        const current = readAutomaticExecutionTicks(ctx) ?? 0;
        const desired = importable.repeatTicks ?? 0;
        return {
            iconNeedsApply,
            automaticExecution: {
                current,
                desired,
                needsApply: current !== desired,
            },
        };
    } finally {
        await clickGoBack(ctx);
    }
}

function functionSettingsPlanNeedsApply(
    plan: FunctionSettingsPlan | null
): boolean {
    return plan !== null && (
        plan.iconNeedsApply ||
        plan.automaticExecution.needsApply
    );
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
    return actionsNoOp && !functionSettingsPlanNeedsApply(plan.settingsPlan);
}

export function reconstructPartialFunction(
    plan: FunctionImportPlan,
    result: ActionListApplyResult | null
): Importable | null {
    const current = result?.currentSnapshot;
    if (current === undefined || !actionsFullyHydrated(current)) return null;
    return {
        type: "FUNCTION",
        name: plan.importable.name,
        actions: current.slice() as Action[],
    };
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
