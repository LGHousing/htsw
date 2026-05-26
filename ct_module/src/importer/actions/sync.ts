import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import type {
    ActionListDiff,
    ActionListTrust,
    ObservedActionSlot,
} from "../types";
import type { ProgressHandler } from "../progress/types";
import { baselineActionListFromSlots, diffActionList } from "./diff";
import { applyActionListDiff } from "./applyDiff";
import { canonicalizeActionItemName, readActionList } from "./readList";
import { actionLogLabel, editDiffSummary } from "./log";
import { estimateActionListPhaseUnits } from "../progress/costs";
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

export async function syncActionList(
    ctx: TaskContext,
    desired: Action[],
    options?: SyncActionListOptions
): Promise<SyncActionListResult> {
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
        (await readActionList(ctx, {
            kind: "sync",
            desired,
            itemRegistry: options?.itemRegistry,
            trust: options?.trust,
            progress,
            phaseUnits,
            pathPrefix: options?.pathPrefix,
            events: options?.events,
        }));
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
    logActionSyncState(ctx, diff);
    await applyActionListDiff(
        ctx,
        observed,
        desired,
        diff,
        options?.itemRegistry,
        options?.pathPrefix,
        phaseUnits,
        options?.events,
        progressScope
    );
    return { usedObserved: observed };
}

function logActionSyncState(ctx: TaskContext, diff: ActionListDiff): void {
    if (diff.operations.length === 0) {
        ctx.displayMessage(`&7[sync] &aUp to date.`);
        return;
    }

    const deletes = diff.operations.filter((op) => op.kind === "delete");
    const edits = diff.operations.filter((op) => op.kind === "edit");
    const moves = diff.operations.filter((op) => op.kind === "move");
    const adds = diff.operations.filter((op) => op.kind === "add");

    ctx.displayMessage(
        `&7[sync] &d${diff.operations.length} ops &7(&c${deletes.length} del &6${edits.length} edit &e${moves.length} move &a${adds.length} add&7)`
    );

    for (const op of diff.operations) {
        switch (op.kind) {
            case "delete":
                ctx.displayMessage(
                    `&7  &c-DEL [${op.fromIndex}] ${actionLogLabel(op.baselineAction)}`
                );
                break;
            case "edit":
                if (op.noteOnly) {
                    ctx.displayMessage(
                        `&7  &6~NOTE [${op.fromIndex}] ${actionLogLabel(op.baselineAction)}`
                    );
                } else {
                    ctx.displayMessage(
                        `&7  &6~EDIT [${op.fromIndex}] ${actionLogLabel(op.baselineAction)}: ${editDiffSummary(op)}`
                    );
                }
                break;
            case "add":
                ctx.displayMessage(
                    `&7  &a+ADD [${op.toIndex}] ${actionLogLabel(op.desired)}`
                );
                break;
            case "move":
                ctx.displayMessage(
                    `&7  &e>MOV [${op.fromIndex} -> ${op.toIndex}] ${actionLogLabel(op.action)}`
                );
                break;
        }
    }
}
