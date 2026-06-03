import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import type {
    ActionListDiff,
    ActionListTrust,
    ObservedActionSlot,
} from "../types";
import type { PhaseUnits, ProgressHandler } from "../progress/types";
import { baselineActionListFromSlots, diffActionList } from "./diff";
import { applyActionListDiff } from "./applyDiff";
import { canonicalizeActionItemName, readActionList } from "./readList";
import {
    actionListDiffApplyUnits,
    editUnitsWithNested,
    estimateActionListPhaseUnits,
    phaseUnitsTotal,
} from "../progress/costs";
import type { ImportEventHandler, ProgressScope } from "../importEvents";

export type SyncActionListOptions = {
    /**
     * Pre-read observed list to use instead of reading from the menu.
     *
     * The exporter and (future) trust-mode hand the importer a known-good
     * observation so a second `readActionList` round trip can be avoided.
     * If absent, the menu is read in `{ kind: "sync", desired }` mode as
     * before.
     */
    observed?: ObservedActionSlot[];
    itemRegistry?: ItemRegistry;
    trust?: ActionListTrust;
    /** Source path prefix for nested lists, e.g. `4.ifActions`. */
    pathPrefix?: string;
    baselineCurrent?: readonly Action[];
    progressScope?: ProgressScope;
    events?: ImportEventHandler;
};

export type SyncActionListResult = {
    /**
     * The observed list the diff was computed against — either the one
     * passed in via `options.observed`, or a fresh read. Returned so
     * callers can hand it to the knowledge writer without re-reading.
     */
    usedObserved: ObservedActionSlot[];
};

/**
 * A pre-read plan: the observed list, the desired list, the diff, and
 * the phase-unit predictions computed from them. Stored between the
 * two-pass orchestrator's pre-read and apply passes. The `observed`
 * array's ItemSlot references go stale when the menu closes between
 * passes, but `applyActionListDiff` re-acquires slots via
 * `getPaginatedListSlotAtIndex`, so the data survives.
 */
export type ActionListPlan = {
    desired: Action[];
    observed: ObservedActionSlot[];
    diff: ActionListDiff;
    phaseUnits: PhaseUnits;
    /**
     * Reads the live top-level list as it stands right now (mutated in place
     * as ops apply). Lets a caller capture the true current Housing state if
     * the apply throws partway, to persist a partial knowledge cache. Set once
     * the apply pass starts.
     */
    getLiveCurrent?: () => Array<Action | null>;
};

export async function prereadActionList(
    ctx: TaskContext,
    desired: Action[],
    options?: SyncActionListOptions
): Promise<ActionListPlan> {
    const phaseUnits = estimateActionListPhaseUnits(desired, options?.baselineCurrent);
    const progressScope: ProgressScope = options?.progressScope ?? { kind: "topLevel" };
    const progress: ProgressHandler | undefined =
        options?.events === undefined
            ? undefined
            : (event) => options.events?.emit({
                  kind: "progress",
                  scope: progressScope,
                  progress: event,
              });
    const observed =
        options?.observed ??
        (await readActionList(ctx,
            {
                kind: "sync",
                desired,
                trust: options?.trust,
            },
            {
                itemRegistry: options?.itemRegistry,
                progress,
                phaseUnits,
                pathPrefix: options?.pathPrefix,
                events: options?.events,
            }
        ));
    if (options?.itemRegistry !== undefined) {
        for (const entry of observed) {
            if (entry.action !== null) {
                canonicalizeActionItemName(entry.action, options.itemRegistry);
            }
        }
        for (const action of desired) {
            canonicalizeActionItemName(action, options.itemRegistry);
        }
    }
    const diff = diffActionList(baselineActionListFromSlots(observed), desired);

    // Replace the rough applying estimate with the diff-aware cost now
    // that we know the actual operations. Emit a progress event so the
    // reducer parks this importable with a precise apply estimate;
    // otherwise the queue + big bar segments stay sized against the
    // upfront rough estimate until pass-2 actually starts and
    // applyActionListDiff resets phaseUnits.applying itself.
    const exactApplyUnits = actionListDiffApplyUnits(
        diff,
        editUnitsWithNested,
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

export async function applyActionListPlan(
    ctx: TaskContext,
    plan: ActionListPlan,
    options?: SyncActionListOptions
): Promise<void> {
    const progressScope: ProgressScope = options?.progressScope ?? { kind: "topLevel" };
    await applyActionListDiff(
        ctx,
        plan.observed,
        plan.desired,
        plan.diff,
        options?.itemRegistry,
        options?.pathPrefix,
        plan.phaseUnits,
        options?.events,
        progressScope,
        (readCurrent) => {
            plan.getLiveCurrent = readCurrent;
        }
    );
}

export async function syncActionList(
    ctx: TaskContext,
    desired: Action[],
    options?: SyncActionListOptions
): Promise<SyncActionListResult> {
    const plan = await prereadActionList(ctx, desired, options);
    await applyActionListPlan(ctx, plan, options);
    return { usedObserved: plan.observed };
}

