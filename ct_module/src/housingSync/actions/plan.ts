import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { ActionSyncConflict, ActionSyncContext } from "./syncContext";
import type { ActionListTrust } from "./applyTrust";
import type { ActionListDiff } from "./diff/types";
import type { ObservedActionSlot } from "../observedActions";
import type { PhaseUnits, ProgressHandler } from "../progress/types";
import type { ListReadOptions } from "../context/actionReadContext";
import { baselineActionListFromSlots, diffActionList } from "./diff";
import { hydrateActionListScan } from "./hydration/run";
import {
    canonicalizeActionItemName,
    emitObservedSnapshot,
    scanActionList,
} from "./readList";
import {
    actionListDiffApplyUnits,
    editUnitsWithChildLists,
    estimateActionListPhaseUnits,
    estimateTrustedActionListHydrateUnits,
} from "../progress/costs";
import type { ProgressScope } from "../syncEvents";
import type { ActionListPath } from "../actionPath";
import { actionListConflictVerdict } from "./conflicts";
import { logActionListConflict } from "./conflictLog";
import { importableKey } from "../../importables/identity";
import { overwriteWarningsEnabled } from "../../importables/overwriteWarning";
import type { ItemFieldContent } from "../items/fieldContent";
import { fullyHydratedActionsFromSlots } from "./hydration/plan";
import { actionListConflictDifferences } from "./conflictDetails";
import { captureDiffInput, isDiffCaptureEnabled } from "./diff/diffCapture";

export type ActionListApplyOptions = {
    sync: ActionSyncContext;
    listPath?: ActionListPath;
    progressScope?: ProgressScope;
};

export type ActionListPlanOptions = ActionListApplyOptions & {
    trust?: ActionListTrust;
    baselineCurrent?: readonly Action[];
    trustedBaselineAfterUnchangedScan?: readonly Action[];
    conflictTarget?: ActionSyncConflict;
    progress?: ProgressHandler;
};

export type ActionListPlan = {
    readonly desired: Action[];
    readonly observed: ObservedActionSlot[];
    readonly diff: ActionListDiff;
    readonly phaseUnits: Readonly<PhaseUnits>;
};

export function actionListPlanNeedsApply(
    plan: ActionListPlan | null
): plan is ActionListPlan {
    return plan !== null && plan.diff.operations.length > 0;
}

export type ActionListPlanScan =
    | { kind: "planned"; plan: ActionListPlan }
    | {
          kind: "hydrate";
          desired: Action[];
          scan: Awaited<ReturnType<typeof scanActionList>>;
          options: ActionListPlanOptions;
          readOptions: ListReadOptions;
          phaseUnits: PhaseUnits;
      };

export async function readActionListPlan(
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPlanOptions
): Promise<ActionListPlan> {
    const scan = await scanActionListForPlan(ctx, desired, options);
    return scan.kind === "planned" ? scan.plan : hydrateActionListForPlan(ctx, scan);
}

export async function scanActionListForPlan(
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPlanOptions
): Promise<ActionListPlanScan> {
    const phaseUnits = estimateActionListPhaseUnits(desired, options.baselineCurrent);
    if (options.trust !== undefined && options.baselineCurrent !== undefined) {
        phaseUnits.hydrating = estimateTrustedActionListHydrateUnits(
            desired,
            options.baselineCurrent,
            options.trust.basePath,
            options.trust.trustedChildListPaths
        );
    }
    const progressScope: ProgressScope = options.progressScope ?? { kind: "topLevel" };
    const progress: ProgressHandler | undefined =
        options.progress ??
        (options.sync.events === undefined
            ? undefined
            : (event) =>
                  options.sync.events?.emit({
                      kind: "progress",
                      scope: progressScope,
                      progress: event,
                  }));
    const itemRead =
        options.sync.itemRead.mode === "sync"
            ? {
                  itemReadMode: "sync" as const,
                  canonicalizeItemName: options.sync.canonicalizeItemName,
                  itemFieldObservations: options.sync.itemFieldObservations,
              }
            : {
                  itemReadMode: "verify" as const,
                  canonicalizeItemName: options.sync.canonicalizeItemName,
                  itemCaptures: options.sync.itemRead.captures,
              };
    const readOptions = {
        ...itemRead,
        progress,
        phaseUnits,
        listPath: options.listPath,
        events: options.sync.events,
    };
    const scan = await scanActionList(
        ctx,
        {
            kind: "sync",
            desired,
            trust: options.trust,
        },
        readOptions
    );
    const conflictVerdict = options.sync.trust.trustMode
        ? recordActionListConflict({ slots: scan.slots }, desired, options)
        : null;
    if (
        conflictVerdict === "unchanged" &&
        options.trustedBaselineAfterUnchangedScan !== undefined
    ) {
        phaseUnits.hydrating = 0;
        const plan = knownActionListPlan(
            desired,
            options.trustedBaselineAfterUnchangedScan,
            options,
            phaseUnits
        );
        if (options.listPath === undefined) {
            emitObservedSnapshot(plan.observed, options.sync.events);
        }
        return { kind: "planned", plan };
    }
    return {
        kind: "hydrate",
        desired,
        scan,
        options,
        readOptions,
        phaseUnits,
    };
}

export async function hydrateActionListForPlan(
    ctx: TaskContext,
    pending: Extract<ActionListPlanScan, { kind: "hydrate" }>
): Promise<ActionListPlan> {
    const { desired, scan, options, readOptions, phaseUnits } = pending;
    await hydrateActionListScan(ctx, scan, readOptions);
    const observed = scan.slots;
    for (const entry of observed) {
        if (entry.action !== null) {
            canonicalizeActionItemName(entry.action, options.sync.canonicalizeItemName);
        }
    }
    for (const action of desired) {
        canonicalizeActionItemName(action, options.sync.canonicalizeItemName);
    }
    if (options.sync.trust.trustMode) {
        const liveActions = fullyHydratedActionsFromSlots(observed);
        if (liveActions !== null) {
            recordKnownConflictEvidence(liveActions, desired, options);
        }
    }
    if (!options.sync.trust.trustMode) {
        recordActionListConflict({ slots: observed }, desired, options);
    }
    const current = baselineActionListFromSlots(observed);
    if (isDiffCaptureEnabled()) {
        captureDiffInput(
            diffCaptureLabel(options),
            current,
            desired,
            options.sync.itemDiff !== undefined,
            "hydrated",
            options.sync.trust.trustMode
        );
    }
    const diff = diffActionList(current, desired, options.sync.itemDiff);
    phaseUnits.applying = exactApplyUnits(diff, desired.length);
    return { desired, observed, diff, phaseUnits };
}

export function createKnownEmptyActionListPlan(
    desired: Action[],
    options: ActionListPlanOptions
): ActionListPlan {
    return createKnownActionListPlan(desired, [], options);
}

export function createKnownActionListPlan(
    desired: Action[],
    current: readonly Action[],
    options: ActionListPlanOptions
): ActionListPlan {
    const phaseUnits = estimateActionListPhaseUnits(desired, current);
    phaseUnits.reading = 0;
    phaseUnits.hydrating = 0;
    return knownActionListPlan(desired, current, options, phaseUnits);
}

function knownActionListPlan(
    desired: Action[],
    current: readonly Action[],
    options: ActionListPlanOptions,
    phaseUnits: PhaseUnits,
    liveItemContent?: ItemFieldContent
): ActionListPlan {
    const observed = current.map((action, index) => ({
        index,
        action: JSON.parse(JSON.stringify(action)) as Action,
        hydrated: true,
        truncatedFields: [],
    }));
    for (const entry of observed) {
        canonicalizeActionItemName(entry.action, options.sync.canonicalizeItemName);
    }
    for (const action of desired) {
        canonicalizeActionItemName(action, options.sync.canonicalizeItemName);
    }
    recordActionListConflict(
        {
            actions: observed.map((entry) => entry.action),
        },
        desired,
        options,
        liveItemContent
    );
    const currentEntries = baselineActionListFromSlots(observed);
    if (isDiffCaptureEnabled()) {
        captureDiffInput(
            diffCaptureLabel(options),
            currentEntries,
            desired,
            options.sync.itemDiff !== undefined,
            "known",
            options.sync.trust.trustMode
        );
    }
    const diff = diffActionList(currentEntries, desired, options.sync.itemDiff);
    phaseUnits.applying = exactApplyUnits(diff, desired.length);
    return { desired, observed, diff, phaseUnits };
}

function exactApplyUnits(diff: ActionListDiff, desiredLength: number): number {
    return actionListDiffApplyUnits(diff, editUnitsWithChildLists, desiredLength);
}

function diffCaptureLabel(options: ActionListPlanOptions): string {
    const target = options.conflictTarget;
    return target === undefined
        ? "actionList"
        : `${target.type}:${target.identity}:${target.basePath}`;
}

function recordActionListConflict(
    live: { slots: readonly ObservedActionSlot[] } | { actions: readonly Action[] },
    desired: readonly Action[],
    options: ActionListPlanOptions,
    liveItemContent?: ItemFieldContent
): ReturnType<typeof actionListConflictVerdict> {
    const target = options.conflictTarget;
    const trustedImport = options.sync.trust.trustMode;
    if (
        target === undefined ||
        !overwriteWarningsEnabled(options.sync.overwriteWarningMode, trustedImport)
    ) {
        return null;
    }
    const trustPlan = options.sync.trust.importables.get(
        importableKey(target.type, target.identity)
    );
    const itemContent = options.sync.itemDiff?.fieldContent;
    const lock = {
        contentHash: trustPlan?.lockListContentHashes?.[target.basePath],
        scanHash: trustPlan?.lockListScanHashes?.[target.basePath],
    };
    const hashFamily = trustedImport ? ("scan" as const) : ("content" as const);
    const verdict = actionListConflictVerdict(
        live,
        lock,
        desired,
        hashFamily,
        liveItemContent ?? itemContent,
        itemContent
    );
    if (verdict === "conflict") {
        const liveActions =
            "actions" in live
                ? live.actions
                : fullyHydratedActionsFromSlots(live.slots);
        const canonicalDifferences =
            liveActions === null
                ? null
                : actionListConflictDifferences(
                      liveActions,
                      desired,
                      liveItemContent ?? itemContent,
                      itemContent
                  );
        const hashComparisonDisagreement = canonicalDifferences?.length === 0;
        if (!hashComparisonDisagreement) {
            options.sync.conflicts.push(target);
        }
        if (liveActions !== null) {
            upsertConflictEvidence(
                liveActions,
                desired,
                options,
                liveItemContent ?? itemContent,
                itemContent
            );
        }
        logActionListConflict({
            target,
            hashFamily,
            live,
            lock,
            source: desired,
            liveItemContent: liveItemContent ?? itemContent,
            sourceItemContent: itemContent,
            hashComparisonDisagreement,
        });
    }
    return verdict;
}

function recordKnownConflictEvidence(
    liveActions: readonly Action[],
    desired: readonly Action[],
    options: ActionListPlanOptions
): void {
    const target = options.conflictTarget;
    if (
        target === undefined ||
        !options.sync.conflicts.some(
            (conflict) =>
                conflict.type === target.type &&
                conflict.identity === target.identity &&
                conflict.basePath === target.basePath
        )
    ) {
        return;
    }
    const itemContent = options.sync.itemDiff?.fieldContent;
    upsertConflictEvidence(
        liveActions,
        desired,
        options,
        itemContent,
        itemContent
    );
}

function upsertConflictEvidence(
    liveActions: readonly Action[],
    sourceActions: readonly Action[],
    options: ActionListPlanOptions,
    liveItemContent?: ItemFieldContent,
    sourceItemContent?: ItemFieldContent
): void {
    const target = options.conflictTarget;
    const evidence = options.sync.conflictEvidence;
    if (target === undefined) return;
    const baselineActions = options.baselineCurrent;
    const entry = {
        ...target,
        baselineActions,
        housingChangesSinceBaseline:
            baselineActions === undefined
                ? undefined
                : actionListConflictDifferences(
                      liveActions,
                      baselineActions,
                      liveItemContent
                  ),
        projectChangesSinceBaseline:
            baselineActions === undefined
                ? undefined
                : actionListConflictDifferences(
                      sourceActions,
                      baselineActions,
                      sourceItemContent
                  ),
        liveActions,
        sourceActions,
        canonicalDifferences: actionListConflictDifferences(
            liveActions,
            sourceActions,
            liveItemContent,
            sourceItemContent
        ),
    };
    const index = evidence.findIndex(
        (candidate) =>
            candidate.type === target.type &&
            candidate.identity === target.identity &&
            candidate.basePath === target.basePath
    );
    if (index < 0) {
        evidence.push(entry);
    } else {
        evidence[index] = entry;
    }
}
