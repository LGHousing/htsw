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
    phaseUnitsTotal,
} from "../progress/costs";
import type { ProgressScope } from "../syncEvents";
import type { ActionListPath } from "../actionPath";
import { actionListConflictVerdict } from "./conflicts";
import { importableKey } from "../../importables/identity";
import { overwriteWarningsEnabled } from "../../importables/overwriteWarning";
import {
    actionListScanHashFromActions,
    actionListScanHashFromSlots,
} from "./scanHash";
import { conflictIdentifier } from "../../importables/import/conflictResolution";
import {
    itemFieldContentFromSnapshot,
    type ItemFieldContent,
} from "../items/fieldContent";

export type ActionListApplyOptions = {
    sync: ActionSyncContext;
    listPath?: ActionListPath;
    progressScope?: ProgressScope;
};

export type ActionListPrereadOptions = ActionListApplyOptions & {
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
    readonly conflictTarget?: ActionSyncConflict;
};

export type ActionListPlanScan =
    | { kind: "planned"; plan: ActionListPlan }
    | {
          kind: "hydrate";
          desired: Action[];
          scan: Awaited<ReturnType<typeof scanActionList>>;
          options: ActionListPrereadOptions;
          readOptions: ListReadOptions;
          phaseUnits: PhaseUnits;
          progress: ProgressHandler | undefined;
      };

export async function readActionListPlan(
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPrereadOptions
): Promise<ActionListPlan> {
    const scan = await scanActionListForPlan(ctx, desired, options);
    return scan.kind === "planned" ? scan.plan : hydrateActionListForPlan(ctx, scan);
}

export async function scanActionListForPlan(
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPrereadOptions
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
    const staged =
        options.conflictTarget === undefined
            ? undefined
            : options.sync.trust.importables
                  .get(
                      importableKey(
                          options.conflictTarget.type,
                          options.conflictTarget.identity
                      )
                  )
                  ?.stagedActionLists?.get(options.conflictTarget.basePath);
    if (
        options.sync.freshHydration !== true &&
        staged !== undefined &&
        actionListScanHashFromSlots(scan.slots) === staged.scanHash
    ) {
        // Freshness is certified at scan level: action types and child-list
        // structure, the same profile as trusted mode. Conflict comparison
        // still uses the staged list's fully hydrated content below.
        phaseUnits.hydrating = 0;
        const plan = knownActionListPlan(
            desired,
            staged.actions,
            options,
            phaseUnits,
            itemFieldContentFromSnapshot(staged.itemFields)
        );
        if (options.listPath === undefined) {
            emitObservedSnapshot(plan.observed, options.sync.events);
        }
        emitPrereadCompleted(progress, plan.phaseUnits);
        return { kind: "planned", plan };
    }
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
        emitPrereadCompleted(progress, plan.phaseUnits);
        return { kind: "planned", plan };
    }
    return {
        kind: "hydrate",
        desired,
        scan,
        options,
        readOptions,
        phaseUnits,
        progress,
    };
}

export async function hydrateActionListForPlan(
    ctx: TaskContext,
    pending: Extract<ActionListPlanScan, { kind: "hydrate" }>
): Promise<ActionListPlan> {
    const { desired, scan, options, readOptions, phaseUnits, progress } = pending;
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
    if (!options.sync.trust.trustMode) {
        recordActionListConflict({ slots: observed }, desired, options);
    }
    const diff = diffActionList(
        baselineActionListFromSlots(observed),
        desired,
        options.sync.itemDiff
    );
    phaseUnits.applying = exactApplyUnits(diff, desired.length);
    emitPrereadCompleted(progress, phaseUnits);

    return {
        desired,
        observed,
        diff,
        phaseUnits,
        conflictTarget: options.conflictTarget,
    };
}

export function createKnownEmptyActionListPlan(
    desired: Action[],
    options: ActionListPrereadOptions
): ActionListPlan {
    return createKnownActionListPlan(desired, [], options);
}

export function createKnownActionListPlan(
    desired: Action[],
    current: readonly Action[],
    options: ActionListPrereadOptions
): ActionListPlan {
    const phaseUnits = estimateActionListPhaseUnits(desired, current);
    phaseUnits.reading = 0;
    phaseUnits.hydrating = 0;
    return knownActionListPlan(desired, current, options, phaseUnits);
}

function knownActionListPlan(
    desired: Action[],
    current: readonly Action[],
    options: ActionListPrereadOptions,
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
    const diff = diffActionList(
        baselineActionListFromSlots(observed),
        desired,
        options.sync.itemDiff
    );
    phaseUnits.applying = exactApplyUnits(diff, desired.length);
    return {
        desired,
        observed,
        diff,
        phaseUnits,
        conflictTarget: options.conflictTarget,
    };
}

function exactApplyUnits(diff: ActionListDiff, desiredLength: number): number {
    return Math.max(
        actionListDiffApplyUnits(diff, editUnitsWithChildLists, desiredLength),
        1
    );
}

function emitPrereadCompleted(
    progress: ProgressHandler | undefined,
    phaseUnits: PhaseUnits
): void {
    progress?.({
        phase: "hydrating",
        completedUnits: phaseUnits.reading + phaseUnits.hydrating,
        totalUnits: phaseUnitsTotal(phaseUnits),
        phaseUnits,
        sync: { completedUnits: 1, totalUnits: 1, parent: null },
    });
}

function recordActionListConflict(
    live: { slots: readonly ObservedActionSlot[] } | { actions: readonly Action[] },
    desired: readonly Action[],
    options: ActionListPrereadOptions,
    liveItemContent?: ItemFieldContent
): ReturnType<typeof actionListConflictVerdict> {
    const target = options.conflictTarget;
    const actions =
        "slots" in live
            ? live.slots
                  .map((entry) => entry.action)
                  .filter((action): action is Action => action !== null)
            : live.actions.slice();
    const trustPlan =
        target === undefined
            ? undefined
            : options.sync.trust.importables.get(
                  importableKey(target.type, target.identity)
              );
    const staged =
        target === undefined
            ? undefined
            : trustPlan?.stagedActionLists?.get(target.basePath);
    if (target !== undefined) {
        options.sync.conflictEvidence?.set(conflictIdentifier(target), {
            ...target,
            expectedActions: (staged?.actions ?? desired).slice(),
            ...(!("slots" in live) || actions.length === live.slots.length
                ? { liveActions: actions }
                : {}),
            liveScanHash:
                "slots" in live
                    ? actionListScanHashFromSlots(live.slots)
                    : actionListScanHashFromActions(live.actions),
            expectedScanHash:
                staged?.scanHash ?? actionListScanHashFromActions(desired),
        });
    }
    if (
        target !== undefined &&
        options.sync.conflictTargets !== undefined &&
        !options.sync.conflictTargets.some(
            (entry) => conflictIdentifier(entry) === conflictIdentifier(target)
        )
    ) {
        options.sync.conflictTargets.push(target);
    }
    const trustedImport = options.sync.trust.trustMode;
    if (target !== undefined) {
        if (!("slots" in live) || actions.length === live.slots.length) {
            options.sync.observedActionLists?.set(conflictIdentifier(target), actions);
        }
    }
    if (
        target === undefined ||
        !overwriteWarningsEnabled(options.sync.overwriteWarningMode, trustedImport)
    ) {
        return null;
    }
    const itemContent =
        options.sync.itemDiff?.fieldContent === undefined
            ? undefined
            : (owner: Action | import("htsw/types").Condition, property: string) =>
                  options.sync.itemDiff?.fieldContent?.(owner, property);
    const verdict = actionListConflictVerdict(
        live,
        {
            contentHash: trustPlan?.lockListContentHashes?.[target.basePath],
            scanHash: trustPlan?.lockListScanHashes?.[target.basePath],
        },
        desired,
        trustedImport ? "scan" : "content",
        liveItemContent ?? itemContent,
        itemContent
    );
    if (verdict === "conflict") {
        options.sync.conflicts.push(target);
        if (!("slots" in live) || actions.length === live.slots.length) {
            options.sync.observedConflictLists?.set(conflictIdentifier(target), actions);
        }
    }
    return verdict;
}
