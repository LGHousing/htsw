import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { ImportSession } from "../../importables/imports";
import type { ActionListTrust } from "./applyTrust";
import type { ActionListDiff } from "./diff/types";
import type { ObservedActionSlot } from "../observedActions";
import type { PhaseUnits, ProgressHandler } from "../progress/types";
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
    phaseUnitsTotal,
} from "../progress/costs";
import type { ProgressScope } from "../syncEvents";
import type { ActionListPath } from "../actionPath";
import type { ImportConflict } from "../../importables/importConflicts";
import { scanConflictVerdict } from "../../importables/importConflicts";
import { importableKey } from "../../importables/identity";
import { actionListScanHashFromActions, actionListScanHashFromSlots } from "./scanHash";

export type ActionListApplyOptions = {
    session: ImportSession;
    listPath?: ActionListPath;
    progressScope?: ProgressScope;
};

export type ActionListPrereadOptions = ActionListApplyOptions & {
    trust?: ActionListTrust;
    baselineCurrent?: readonly Action[];
    trustedBaselineAfterUnchangedScan?: readonly Action[];
    conflictTarget?: ImportConflict;
};

export type ActionListPlan = {
    readonly desired: Action[];
    readonly observed: ObservedActionSlot[];
    readonly diff: ActionListDiff;
    readonly phaseUnits: Readonly<PhaseUnits>;
};

export async function prereadActionList(
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPrereadOptions
): Promise<ActionListPlan> {
    const phaseUnits = estimateActionListPhaseUnits(desired, options.baselineCurrent);
    const progressScope: ProgressScope = options.progressScope ?? { kind: "topLevel" };
    const progress: ProgressHandler | undefined =
        options.session.events === undefined
            ? undefined
            : (event) =>
                  options.session.events?.emit({
                      kind: "progress",
                      scope: progressScope,
                      progress: event,
                  });
    const itemRead =
        options.session.actionItemRead.mode === "sync"
            ? {
                  itemReadMode: "sync" as const,
                  canonicalizeItemName: options.session.canonicalizeItemName,
                  itemFieldObservations: options.session.itemFieldObservations,
              }
            : {
                  itemReadMode: "verify" as const,
                  canonicalizeItemName: options.session.canonicalizeItemName,
                  itemCaptures: options.session.actionItemRead.captures,
              };
    const readOptions = {
        ...itemRead,
        progress,
        phaseUnits,
        listPath: options.listPath,
        events: options.session.events,
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
    const conflictVerdict = recordActionListConflict(
        actionListScanHashFromSlots(scan.slots),
        desired,
        options
    );
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
            emitObservedSnapshot(plan.observed, options.session.events);
        }
        emitPrereadCompleted(progress, plan.phaseUnits);
        return plan;
    }
    await hydrateActionListScan(ctx, scan, readOptions);
    const observed = scan.slots;
    for (const entry of observed) {
        if (entry.action !== null) {
            canonicalizeActionItemName(
                entry.action,
                options.session.canonicalizeItemName
            );
        }
    }
    for (const action of desired) {
        canonicalizeActionItemName(action, options.session.canonicalizeItemName);
    }
    const diff = diffActionList(
        baselineActionListFromSlots(observed),
        desired,
        options.session.itemDiff
    );
    phaseUnits.applying = exactApplyUnits(diff, desired.length);
    emitPrereadCompleted(progress, phaseUnits);

    return { desired, observed, diff, phaseUnits };
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
    recordActionListConflict(actionListScanHashFromActions(current), desired, options);
    const phaseUnits = estimateActionListPhaseUnits(desired, current);
    phaseUnits.reading = 0;
    phaseUnits.hydrating = 0;
    return knownActionListPlan(desired, current, options, phaseUnits);
}

function knownActionListPlan(
    desired: Action[],
    current: readonly Action[],
    options: ActionListPrereadOptions,
    phaseUnits: PhaseUnits
): ActionListPlan {
    const observed = current.map((action, index) => ({
        index,
        action: JSON.parse(JSON.stringify(action)) as Action,
        hydrated: true,
        truncatedFields: [],
    }));
    for (const entry of observed) {
        canonicalizeActionItemName(entry.action, options.session.canonicalizeItemName);
    }
    for (const action of desired) {
        canonicalizeActionItemName(action, options.session.canonicalizeItemName);
    }
    const diff = diffActionList(
        baselineActionListFromSlots(observed),
        desired,
        options.session.itemDiff
    );
    phaseUnits.applying = exactApplyUnits(diff, desired.length);
    return { desired, observed, diff, phaseUnits };
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
    liveHash: string,
    desired: readonly Action[],
    options: ActionListPrereadOptions
): ReturnType<typeof scanConflictVerdict> | null {
    const target = options.conflictTarget;
    if (target === undefined || !options.session.trust.trustMode) return null;
    const trustPlan = options.session.trust.importables.get(
        importableKey(target.type, target.identity)
    );
    const lockHash = trustPlan?.lockListScanHashes?.[target.basePath];
    const verdict = scanConflictVerdict(
        liveHash,
        lockHash,
        actionListScanHashFromActions(desired)
    );
    if (verdict === "conflict") {
        options.session.conflicts.push(target);
    }
    return verdict;
}
