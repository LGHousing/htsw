import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { ImportSession } from "../../importables/imports";
import type { ActionListTrust } from "./applyTrust";
import type { ActionListDiff } from "./diff/types";
import type { ObservedActionSlot } from "../observedActions";
import type { PhaseUnits, ProgressHandler } from "../progress/types";
import { baselineActionListFromSlots, diffActionList } from "./diff";
import { hydrateActionListScan } from "./hydration/run";
import { canonicalizeActionItemName, scanActionList } from "./readList";
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
    const readOptions = {
        itemRegistry: options.session.items,
        progress,
        phaseUnits,
        listPath: options.listPath,
        events: options.session.events,
        itemCaptures: options.session.itemCaptures,
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
    recordActionListConflict(actionListScanHashFromSlots(scan.slots), desired, options);
    await hydrateActionListScan(ctx, scan, readOptions);
    const observed = scan.slots;
    for (const entry of observed) {
        if (entry.action !== null) {
            canonicalizeActionItemName(entry.action, options.session.items);
        }
    }
    for (const action of desired) {
        canonicalizeActionItemName(action, options.session.items);
    }
    const diff = diffActionList(baselineActionListFromSlots(observed), desired);
    const exactApplyUnits = actionListDiffApplyUnits(
        diff,
        editUnitsWithChildLists,
        desired.length
    );
    phaseUnits.applying = Math.max(exactApplyUnits, 1);
    progress?.({
        phase: "hydrating",
        completedUnits: phaseUnits.reading + phaseUnits.hydrating,
        totalUnits: phaseUnitsTotal(phaseUnits),
        phaseUnits,
        sync: { completedUnits: 1, totalUnits: 1, parent: null },
    });

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
    const observed = current.map((action, index) => ({
        index,
        action: JSON.parse(JSON.stringify(action)) as Action,
        hydrated: true,
        truncatedFields: [],
    }));
    recordActionListConflict(actionListScanHashFromActions(current), desired, options);
    for (const entry of observed) {
        canonicalizeActionItemName(entry.action, options.session.items);
    }
    for (const action of desired) {
        canonicalizeActionItemName(action, options.session.items);
    }
    const phaseUnits = estimateActionListPhaseUnits(desired, current);
    phaseUnits.reading = 0;
    phaseUnits.hydrating = 0;
    const diff = diffActionList(baselineActionListFromSlots(observed), desired);
    phaseUnits.applying = Math.max(
        actionListDiffApplyUnits(diff, editUnitsWithChildLists, desired.length),
        1
    );
    return { desired, observed, diff, phaseUnits };
}

function recordActionListConflict(
    liveHash: string,
    desired: readonly Action[],
    options: ActionListPrereadOptions
): void {
    const target = options.conflictTarget;
    if (target === undefined || !options.session.trust.trustMode) return;
    const trustPlan = options.session.trust.importables.get(
        importableKey(target.type, target.identity)
    );
    const lockHash = trustPlan?.lockListScanHashes?.[target.basePath];
    if (
        scanConflictVerdict(
            liveHash,
            lockHash,
            actionListScanHashFromActions(desired)
        ) === "conflict"
    ) {
        options.session.conflicts.push(target);
    }
}
