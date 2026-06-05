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
import { canonicalizeActionItemName, readActionList } from "./readList";
import {
    actionListDiffApplyUnits,
    editUnitsWithNested,
    estimateActionListPhaseUnits,
    phaseUnitsTotal,
} from "../progress/costs";
import type { ImportEventHandler, ProgressScope } from "../importEvents";
import type { ActionPath } from "../importEvents";

export type ActionListApplyOptions = {
    itemRegistry?: ItemRegistry;
    listPath?: ActionPath;
    progressScope?: ProgressScope;
    events?: ImportEventHandler;
};

export type ActionListPrereadOptions = ActionListApplyOptions & {
    observed?: ObservedActionSlot[];
    trust?: ActionListTrust;
    baselineCurrent?: readonly Action[];
};

export type ActionListPlan = {
    desired: Action[];
    observed: ObservedActionSlot[];
    diff: ActionListDiff;
    phaseUnits: PhaseUnits;
    getLiveCurrent?: () => Array<Action | null>;
};

export async function prereadActionList(
    ctx: TaskContext,
    desired: Action[],
    options?: ActionListPrereadOptions
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
                listPath: options?.listPath,
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
