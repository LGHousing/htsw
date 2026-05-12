import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import type {
    ActionListDiff,
    ActionListProgressSink,
    ActionListTrust,
    ObservedActionSlot,
} from "../types";
import { diffActionList } from "./diff";
import { applyActionListDiff } from "./applyDiff";
import {
    canonicalizeActionItemName,
    canonicalizeObservedActionItemNames,
    readActionList,
} from "./readList";
import { actionLogLabel, editDiffSummary } from "./log";

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
    onProgress?: ActionListProgressSink;
    /** Source path prefix for nested lists, e.g. `4.ifActions`. */
    pathPrefix?: string;
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
    const observed =
        options?.observed ??
        (await readActionList(ctx, {
            kind: "sync",
            desired,
            itemRegistry: options?.itemRegistry,
            trust: options?.trust,
            onProgress: options?.onProgress,
        }));
    canonicalizeObservedActionItemNames(observed, options?.itemRegistry);
    if (options?.itemRegistry) {
        for (const action of desired) {
            canonicalizeActionItemName(action, options.itemRegistry);
        }
    }
    const diff = diffActionList(observed, desired);
    logActionSyncState(ctx, diff);
    await applyActionListDiff(
        ctx,
        observed,
        desired,
        diff,
        options?.itemRegistry,
        options?.onProgress,
        options?.pathPrefix
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
                    `&7  &c-DEL [${op.observed.index}] ${actionLogLabel(op.observed.action)}`
                );
                break;
            case "edit":
                if (op.noteOnly) {
                    ctx.displayMessage(
                        `&7  &6~NOTE [${op.observed.index}] ${actionLogLabel(op.observed.action)}`
                    );
                } else {
                    ctx.displayMessage(
                        `&7  &6~EDIT [${op.observed.index}] ${actionLogLabel(op.observed.action)}: ${editDiffSummary(op)}`
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
                    `&7  &e>MOV [${op.observed.index} -> ${op.toIndex}] ${actionLogLabel(op.action)}`
                );
                break;
        }
    }
}
