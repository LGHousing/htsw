import { Diagnostic } from "htsw";
import type { Action, Importable, ImportableFunction } from "htsw/types";

import {
    applyActionListPlan,
    type ActionListApplyResult,
} from "../../housingSync/actions/apply";
import {
    actionListPlanNeedsApply,
    type ActionListPlan,
} from "../../housingSync/actions/plan";
import {
    actionsFullyHydrated,
    fullyHydratedActionsFromSlots,
} from "../../housingSync/actions/hydration/plan";
import {
    actionListPlanFromRead,
    hydrateActionListSync,
    scanActionListSync,
    type ActionListSyncScanResult,
} from "../../housingSync/actions/prepareSync";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
import TaskContext from "../../tasks/context";
import type { ImportContext } from "../import/context";
import { importableIdentity } from "../identity";
import { getSessionFunctionNamesLower, openFunctionList } from "./listFunctions";
import {
    applyFunctionSettings,
    ensureFunctionExists,
    openFunctionEditor,
    openFunctionSettings,
    readFunctionSettings,
} from "./housing";
import {
    functionSettingsMatchDesired,
    planFunctionSettingChanges,
    type FunctionSettingChange,
    type ObservedFunctionSettings,
} from "./settings";
import { recordEmptyFunctionShell } from "../import/emptyShells";
import { COST, estimateActionListPhaseUnits } from "../../housingSync/progress/costs";
import { preflightConditionalEdits } from "../../housingSync/actions/conditionalSafety";
import { scanActionList } from "../../housingSync/actions/readList";
import { completeActionListScan } from "../../housingSync/actions/hydration/run";
import {
    baselineActionListFromActions,
    diffActionList,
} from "../../housingSync/actions/diff";
import { fullyHydratedObservedSlotsToActions } from "../../housingSync/observedActions";
import {
    actionListStep,
    defineApplicationPlan,
    workStep,
    type ApplicationPlan,
    type ApplicationProgress,
    type ApplicationStep,
} from "../import/applicationProgress";

export type FunctionImportPlan = {
    kind: "FUNCTION";
    importable: ImportableFunction;
    trustPlan?: ImportableTrustPlan;
    actionsPlan: ActionListPlan | null;
    settingsPlan: FunctionSettingChange[] | null;
    exists: boolean;
};

export type FunctionRead = {
    kind: "FUNCTION";
    importable: ImportableFunction;
    trustPlan?: ImportableTrustPlan;
    exists: boolean;
    actions: ActionListSyncScanResult;
    settings: ObservedFunctionSettings | null;
};

export async function scanImportableFunction(
    ctx: TaskContext,
    importable: ImportableFunction,
    session: ImportContext,
    trustPlan?: ImportableTrustPlan
): Promise<FunctionRead> {
    const setup = createSetupStepEmitter(session.actions.events, 1);
    const exists = (await getSessionFunctionNamesLower(ctx)).has(
        importable.name.toLowerCase()
    );
    const settingsTrusted = exists && functionSettingsTrusted(importable, trustPlan);
    const settings = settingsTrusted
        ? null
        : exists
          ? await readFunctionSettings(ctx, importable.name)
          : { icon: undefined, description: undefined, repeatTicks: 0 };
    const actionsEditor = { opened: false };
    const actions = await scanActionListSync(ctx, {
        desired: importable.actions,
        sync: session.actions,
        trustPlan: exists ? trustPlan : undefined,
        basePath: "actions",
        current: exists ? undefined : { kind: "known-empty" },
        conflictTarget: {
            type: importable.type,
            identity: importableIdentity(importable),
            basePath: "actions",
        },
        open: async () => {
            if ((await openFunctionEditor(ctx, importable.name)) === "missing") {
                throw new Error(`Function ${importable.name} disappeared during read.`);
            }
            actionsEditor.opened = true;
        },
    });
    if (actionsEditor.opened) await clickGoBack(ctx);

    setup(exists ? `scanned ${importable.name}` : `${importable.name} is missing`);
    return { kind: "FUNCTION", importable, trustPlan, exists, actions, settings };
}

export async function hydrateImportableFunction(
    ctx: TaskContext,
    read: FunctionRead
): Promise<void> {
    if (read.actions.kind !== "hydrate") return;
    read.actions = await hydrateActionListSync(ctx, read.actions);
    await clickGoBack(ctx);
}

export function planImportableFunction(read: FunctionRead): FunctionImportPlan {
    return {
        kind: "FUNCTION",
        importable: read.importable,
        trustPlan: read.trustPlan,
        actionsPlan: actionListPlanFromRead(read.actions),
        settingsPlan:
            read.settings === null
                ? null
                : planFunctionSettingChanges(read.settings, read.importable),
        exists: read.exists,
    };
}

export async function applyImportableFunctionPlan(
    ctx: TaskContext,
    plan: FunctionImportPlan,
    session: ImportContext,
    application: ApplicationProgress
): Promise<void> {
    // This must precede settings: a repeat interval can activate the old body.
    if (plan.actionsPlan) preflightConditionalEdits(plan.actionsPlan.diff);
    if (
        !plan.exists &&
        !session.ensuredReferencedShells.functions.has(plan.importable.name.toLowerCase())
    ) {
        await application.run("createShell", async () => {
            await ensureFunctionExists(ctx, plan.importable.name);
            await recordEmptyFunctionShell(ctx, session, plan.importable.name);
            await clickGoBack(ctx);
        });
    }

    const actionsPlan = plan.actionsPlan;
    if (actionListPlanNeedsApply(actionsPlan)) {
        await application.run("openActions", () =>
            ensureFunctionExists(ctx, plan.importable.name)
        );
        await application.runActionList("actions", actionsPlan, session.actions, (sync) =>
            applyActionListPlan(ctx, actionsPlan, {
                sync,
            })
        );
        await application.run("closeActions", () => clickGoBack(ctx));
    }
    if (enablesAutomaticExecution(plan)) {
        await application.run("verifyActions", () =>
            verifyFunctionActions(ctx, plan, session)
        );
    }
    if (functionSettingsPlanNeedsApply(plan.settingsPlan)) {
        await application.run("settings", async () => {
            for (const change of plan.settingsPlan ?? []) {
                await openFunctionList(ctx);
                await functionImportStep(
                    `opening settings for function ${plan.importable.name}`,
                    () => openFunctionSettings(ctx, plan.importable.name)
                );
                await applyFunctionSettings(ctx, plan.importable, [change]);
            }
        });
    }
}

export function functionApplicationPlan(
    plan: FunctionImportPlan,
    session: ImportContext
): ApplicationPlan {
    if (functionPlanIsNoOp(plan)) {
        return defineApplicationPlan([workStep("cache", COST.cacheWrite)]);
    }
    const steps: ApplicationStep[] = [];
    const shellPlanned =
        !plan.exists &&
        session.plannedReferencedShells.functions.has(plan.importable.name.toLowerCase());
    if (!plan.exists && !shellPlanned) {
        steps.push(
            workStep(
                "createShell",
                COST.commandMessageWait +
                    COST.commandMenuWait +
                    COST.goBackWait +
                    COST.cacheWrite
            )
        );
    }
    if (actionListPlanNeedsApply(plan.actionsPlan)) {
        steps.push(
            workStep("openActions", COST.commandMenuWait),
            actionListStep("actions", plan.actionsPlan),
            workStep("closeActions", COST.goBackWait)
        );
    }
    if (enablesAutomaticExecution(plan)) {
        const read = estimateActionListPhaseUnits(plan.importable.actions ?? []);
        steps.push(
            workStep(
                "verifyActions",
                COST.commandMenuWait + COST.goBackWait + read.reading + read.hydrating
            )
        );
    }
    if (functionSettingsPlanNeedsApply(plan.settingsPlan)) {
        let units = 0;
        for (const change of plan.settingsPlan ?? []) {
            units += COST.commandMenuWait + COST.menuClickWait;
            units +=
                change.key === "icon"
                    ? COST.menuClickWait + COST.itemSelect
                    : change.key === "description"
                      ? COST.chatInput
                      : COST.signInput;
        }
        steps.push(workStep("settings", units));
    }
    steps.push(workStep("cache", COST.cacheWrite));
    return defineApplicationPlan(steps);
}

export function functionPlanApplicationUnits(
    plan: FunctionImportPlan,
    session: ImportContext
): number {
    return functionApplicationPlan(plan, session).totalUnits;
}

function enablesAutomaticExecution(plan: FunctionImportPlan): boolean {
    return (
        plan.settingsPlan?.some(
            (change) => change.key === "repeatTicks" && (change.desired ?? 0) > 0
        ) ?? false
    );
}

async function verifyFunctionActions(
    ctx: TaskContext,
    plan: FunctionImportPlan,
    session: ImportContext
): Promise<void> {
    if ((await openFunctionEditor(ctx, plan.importable.name)) === "missing") {
        throw Diagnostic.error(
            `Function ${plan.importable.name} disappeared before automatic execution verification.`
        );
    }
    const read = {
        itemReadMode: "sync" as const,
        canonicalizeItemName: session.actions.canonicalizeItemName,
    };
    const scan = await scanActionList(ctx, { kind: "full" }, read);
    const actual = await completeActionListScan(ctx, scan, read);
    // The export-oriented conversion drops unread entries. Verification must
    // reject those, including unread actions inside a conditional branch.
    fullyHydratedObservedSlotsToActions(scan.slots);
    await clickGoBack(ctx);
    if (
        plan.importable.actions !== undefined &&
        diffActionList(baselineActionListFromActions(actual), plan.importable.actions)
            .operations.length > 0
    ) {
        throw Diagnostic.error(
            `Function ${plan.importable.name} did not verify; automatic execution was not enabled.`
        );
    }
}

function functionSettingsPlanNeedsApply(
    plan: readonly FunctionSettingChange[] | null
): boolean {
    return plan !== null && plan.length > 0;
}

async function functionImportStep<T>(label: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${label}: ${message}`);
    }
}

/**
 * True when applying this plan changes nothing — its action diff is empty and
 * icon/ticks are already handled — so application can be skipped.
 */
export function functionPlanIsNoOp(plan: FunctionImportPlan): boolean {
    const actionsNoOp = !actionListPlanNeedsApply(plan.actionsPlan);
    return (
        plan.exists && actionsNoOp && !functionSettingsPlanNeedsApply(plan.settingsPlan)
    );
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

export function reconstructObservedFunction(plan: FunctionImportPlan): Importable | null {
    if (plan.actionsPlan === null) return null;
    const actions = fullyHydratedActionsFromSlots(plan.actionsPlan.observed);
    if (actions === null) return null;
    return { type: "FUNCTION", name: plan.importable.name, actions };
}

function functionSettingsTrusted(
    importable: ImportableFunction,
    plan: ImportableTrustPlan | undefined
): boolean {
    if (plan?.trustMode !== true || plan.entry?.importable.type !== "FUNCTION") {
        return false;
    }
    const cached = plan.entry.importable;
    return functionSettingsMatchDesired(cached, importable);
}
