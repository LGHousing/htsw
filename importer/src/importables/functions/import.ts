import { IncompleteReadError } from "../../housingSync/incompleteRead";
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
    readFunctionRepeatTicks,
} from "./housing";
import {
    functionSettingsMatchDesired,
    functionSettingsForExport,
    type FunctionSettings,
    planFunctionSettingChanges,
    type FunctionSettingChange,
    type ObservedFunctionSettings,
} from "./settings";
import { COST, estimateActionListPhaseUnits } from "../../housingSync/progress/costs";
import { scanActionList } from "../../housingSync/actions/readList";
import { hydrateActionListScan } from "../../housingSync/actions/hydration/run";
import { fullyHydratedObservedSlotsToActions } from "../../housingSync/observedActions";
import { getChildListFields } from "../../housingSync/fields/actionMappings";
import { compareActionList } from "../../housingSync/actions/conflicts";
import { createItemFieldObservationRecorder } from "../../housingSync/items/fieldObservations";
import {
    actionListStep,
    defineApplicationPlan,
    workStep,
    type ApplicationPlan,
    type ApplicationProgress,
    type ApplicationStep,
} from "../import/applicationProgress";
import { errorMessage } from "../../utils/helpers";

export type FunctionImportPlan = {
    kind: "FUNCTION";
    importable: ImportableFunction;
    trustPlan?: ImportableTrustPlan;
    actionsPlan: ActionListPlan | null;
    settingsPlan: FunctionSettingChange[] | null;
    observedSettings: FunctionSettings;
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
    const cached = read.trustPlan?.entry?.importable;
    const settings = read.settings ?? (cached?.type === "FUNCTION" ? cached : {});
    return {
        observedSettings: functionSettingsForExport(settings),
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
    if (
        !plan.exists &&
        !session.ensuredReferencedShells.functions.has(plan.importable.name.toLowerCase())
    ) {
        await application.run("createShell", async () => {
            await ensureFunctionExists(ctx, plan.importable.name);
            // The active import already invalidated its baseline. Do not cache
            // an empty shell that a failed/disconnected write would leave stale.
            await clickGoBack(ctx);
        });
    }

    const actionsPlan = plan.actionsPlan;
    const bodyChanges = actionListPlanNeedsApply(actionsPlan);
    const changesFunction = !functionPlanIsNoOp(plan);
    const targetTicks = plan.importable.repeatTicks ?? 0;
    let currentTicks = 0;
    let suspended = false;
    if (changesFunction) {
        await application.run("suspendExecution", async () => {
            // Always read live state here, even when metadata was trusted during
            // planning. A prior interrupted import may have left execution off.
            currentTicks = await readFunctionRepeatTicks(ctx, plan.importable.name);
            if (currentTicks > 0) {
                await writeFunctionRepeatTicks(ctx, plan, 0, currentTicks);
                await verifyFunctionRepeatTicks(ctx, plan, 0);
                currentTicks = 0;
                suspended = true;
            }
        });
    }
    if (bodyChanges) {
        await application.run("openActions", () =>
            ensureFunctionExists(ctx, plan.importable.name)
        );
        await application.runActionList("actions", actionsPlan, session.actions, (sync) =>
            applyActionListPlan(ctx, actionsPlan, {
                sync,
                reopenList: async () => {
                    if ((await openFunctionEditor(ctx, plan.importable.name)) === "missing") {
                        throw new Error(`Function "${plan.importable.name}" no longer exists.`);
                    }
                },
            })
        );
        await application.run("closeActions", () => clickGoBack(ctx));
    }
    if (changesFunction) {
        await application.run("verifyActions", async () => {
            if (suspended || targetTicks > 0)
                await verifyFunctionActions(ctx, plan, session);
        });
    }
    const metadata =
        plan.settingsPlan?.filter((change) => change.key !== "repeatTicks") ?? [];
    if (metadata.length > 0) {
        await application.run("settings", async () => {
            for (const change of metadata) {
                await openFunctionList(ctx);
                await functionImportStep(
                    `opening settings for function ${plan.importable.name}`,
                    () => openFunctionSettings(ctx, plan.importable.name)
                );
                await applyFunctionSettings(ctx, plan.importable, [change]);
            }
        });
    }
    if (changesFunction) {
        await application.run("repeatExecution", async () => {
            // Cancellation may arrive with the final body verification response.
            ctx.checkCancelled();
            if (currentTicks !== targetTicks) {
                await writeFunctionRepeatTicks(ctx, plan, targetTicks, currentTicks);
                await verifyFunctionRepeatTicks(ctx, plan, targetTicks);
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
                COST.commandMessageWait + COST.commandMenuWait + COST.goBackWait
            )
        );
    }
    steps.push(workStep("suspendExecution", REPEAT_READ_UNITS * 2 + REPEAT_WRITE_UNITS));
    if (actionListPlanNeedsApply(plan.actionsPlan)) {
        steps.push(
            workStep("openActions", COST.commandMenuWait),
            actionListStep("actions", plan.actionsPlan),
            workStep("closeActions", COST.goBackWait)
        );
    }
    const actions = plan.importable.actions ?? [];
    const read = estimateActionListPhaseUnits(actions, actions);
    steps.push(
        workStep(
            "verifyActions",
            COST.commandMenuWait + COST.goBackWait + read.reading + read.hydrating
        )
    );
    const metadata =
        plan.settingsPlan?.filter((change) => change.key !== "repeatTicks") ?? [];
    if (metadata.length > 0) {
        let units = 0;
        for (const change of metadata) {
            units += COST.commandMenuWait + COST.menuClickWait;
            units +=
                change.key === "icon"
                    ? COST.menuClickWait + COST.itemSelect
                    : COST.chatInput;
        }
        steps.push(workStep("settings", units));
    }
    steps.push(workStep("repeatExecution", REPEAT_WRITE_UNITS + REPEAT_READ_UNITS));
    steps.push(workStep("cache", COST.cacheWrite));
    return defineApplicationPlan(steps);
}

export function functionPlanApplicationUnits(
    plan: FunctionImportPlan,
    session: ImportContext
): number {
    return functionApplicationPlan(plan, session).totalUnits;
}

const REPEAT_READ_UNITS = COST.commandMenuWait + COST.menuClickWait + COST.goBackWait;
const REPEAT_WRITE_UNITS = COST.commandMenuWait + COST.menuClickWait + COST.signInput;

async function writeFunctionRepeatTicks(
    ctx: TaskContext,
    plan: FunctionImportPlan,
    desired: number,
    current: number
): Promise<void> {
    await openFunctionList(ctx);
    await openFunctionSettings(ctx, plan.importable.name);
    await applyFunctionSettings(ctx, plan.importable, [
        { key: "repeatTicks", current, desired },
    ]);
}

async function verifyFunctionRepeatTicks(
    ctx: TaskContext,
    plan: FunctionImportPlan,
    expected: number
): Promise<void> {
    if ((await readFunctionRepeatTicks(ctx, plan.importable.name)) !== expected) {
        throw Diagnostic.error(
            `Function ${plan.importable.name} automatic execution did not verify as ${expected} ticks; no further edits were applied.`
        );
    }
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
    const observations = createItemFieldObservationRecorder();
    const read = {
        itemFieldObservations: observations,
        itemReadMode: "sync" as const,
        canonicalizeItemName: session.actions.canonicalizeItemName,
    };
    const scan = await scanActionList(ctx, { kind: "full" }, read);
    // Verification reads container editors even when their summaries say all
    // lists are empty. In particular, Match Any must be read, never defaulted.
    for (const entry of scan.slots) {
        if (entry.action === null) continue;
        const fields = getChildListFields(entry.action.type);
        if (fields.length === 0) continue;
        const work = scan.plan.get(entry);
        if (work) {
            for (const field of fields) work.childListsToRead.add(field.prop);
        } else {
            scan.plan.set(entry, {
                childListsToRead: new Set(fields.map((field) => field.prop)),
                scalarFieldsToRead: [],
                itemFieldsToCapture: [],
            });
        }
    }
    await hydrateActionListScan(ctx, scan, read);
    // Validate every branch before comparing. Keep the observed nodes themselves:
    // item captures are keyed by their identity, which the strict conversion clones.
    fullyHydratedObservedSlotsToActions(scan.slots);
    const actual = scan.slots.map((slot) => slot.action as Action);
    await clickGoBack(ctx);
    if (
        plan.importable.actions !== undefined &&
        compareActionList(
            { actions: actual },
            { contentHash: undefined, scanHash: undefined },
            plan.importable.actions,
            "content",
            (owner, property) => observations.get(owner, property)?.canonicalKey,
            session.actions.itemDiff?.fieldContent
        )?.sourceDiffersFromLive !== false
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
        if (error instanceof IncompleteReadError) throw error.withContext(label);
        const message = errorMessage(error);
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
    return {
        type: "FUNCTION",
        name: plan.importable.name,
        ...plan.observedSettings,
        actions,
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
    return functionSettingsMatchDesired(cached, importable);
}
