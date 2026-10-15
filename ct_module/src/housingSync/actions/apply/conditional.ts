import { Diagnostic } from "htsw";
import type { Action } from "htsw/types";
import type TaskContext from "../../../tasks/context";
import type { ActionSyncContext } from "../syncContext";
import type { ListReadOptions } from "../../context/actionReadContext";
import { getPaginatedListSlotAtIndex } from "../../menus/paginatedList";
import { clickGoBack, setListItemNote } from "../../menus/menuUtils";
import { timedWaitForMenu } from "../../menus/menuWait";
import { readConditionList } from "../conditions/readList";
import { completeActionListScan } from "../hydration/run";
import { scanActionList } from "../readList";
import { fullyHydratedObservedSlotsToActions } from "../../observedActions";
import { actionsEqual } from "../comparison";
import { writeOpenAction } from "../io";
import { readOpenConditional } from "../readers";
import { ACTION_LIST_CONFIG } from "../listConfigs";
import { CONDITIONAL_BUILD_NOTE } from "../conditionalSafety";
import {
    appendActionsToOpenActionList,
    canAddAction,
    deleteObservedAction,
    moveActionToIndex,
} from "./actionOps";

type ActionConditional = Extract<Action, { type: "CONDITIONAL" }>;

export type ConditionalBlockIo = {
    canStage(): Promise<boolean>;
    appendEmpty(stage: ActionConditional): Promise<void>;
    verify(index: number, length: number, expected: ActionConditional): Promise<void>;
    remove(index: number, length: number): Promise<void>;
    move(from: number, to: number, length: number): Promise<void>;
    populate(
        index: number,
        length: number,
        stage: ActionConditional,
        desired: ActionConditional
    ): Promise<void>;
    finishNote(index: number, length: number, note: string | undefined): Promise<void>;
};

/** Every durable state has only the old guarded body or the new guarded body.
 * Empty staging blocks may coexist; populated bodies never do. At capacity,
 * losing the old block first is preferable to weakening its predicate.
 */
export async function buildConditionalBlock(
    io: ConditionalBlockIo,
    desired: ActionConditional,
    length: number,
    targetIndex: number,
    oldIndex?: number
): Promise<void> {
    const stage: ActionConditional = {
        ...desired,
        note: CONDITIONAL_BUILD_NOTE,
        ifActions: [],
        elseActions: [],
    };
    if (oldIndex !== undefined && !(await io.canStage())) {
        await io.remove(oldIndex, length);
        length--;
        oldIndex = undefined;
    }
    await io.appendEmpty(stage);
    await io.verify(length, length + 1, stage);
    length++;
    if (oldIndex !== undefined) {
        await io.remove(oldIndex, length);
        length--;
    }
    // Position the empty block before installing effects (including EXIT).
    await io.move(length - 1, targetIndex, length);
    // Read again after removal/reordering: never populate a stale slot.
    await io.verify(targetIndex, length, stage);
    const completed = { ...desired, note: CONDITIONAL_BUILD_NOTE };
    await io.populate(targetIndex, length, stage, completed);
    await io.verify(targetIndex, length, completed);
    await io.finishNote(targetIndex, length, desired.note);
}

export function conditionalBlockIo(
    ctx: TaskContext,
    sync: ActionSyncContext
): ConditionalBlockIo {
    const read: ListReadOptions =
        sync.itemRead.mode === "verify"
            ? {
                  itemReadMode: "verify",
                  canonicalizeItemName: sync.canonicalizeItemName,
                  itemCaptures: sync.itemRead.captures,
              }
            : {
                  itemReadMode: "sync",
                  canonicalizeItemName: sync.canonicalizeItemName,
                  itemFieldObservations: sync.itemFieldObservations,
              };
    const open = async (index: number, length: number): Promise<void> => {
        const slot = await getPaginatedListSlotAtIndex(
            ctx,
            index,
            length,
            ACTION_LIST_CONFIG
        );
        slot.click();
        await timedWaitForMenu(ctx, "menuClickWait");
    };
    return {
        canStage: () => canAddAction(ctx, "CONDITIONAL"),
        appendEmpty: (stage) =>
            appendActionsToOpenActionList(ctx, [stage], sync.resolveItem),
        async verify(index, length, expected) {
            await open(index, length);
            const actual = await readOpenConditional({
                ctx,
                childListsToRead: new Set(["conditions", "ifActions", "elseActions"]),
                read: {
                    async readConditions() {
                        return (await readConditionList(ctx, read)).map(
                            (slot) => slot.condition
                        );
                    },
                    async readChildActions() {
                        const scan = await scanActionList(ctx, { kind: "full" }, read);
                        await completeActionListScan(ctx, scan, read);
                        return fullyHydratedObservedSlotsToActions(scan.slots);
                    },
                    emitSnapshot: () => undefined,
                },
            });
            await clickGoBack(ctx);
            if (!actionsEqual({ ...actual, note: expected.note }, expected)) {
                throw Diagnostic.error(
                    "Conditional read-back did not match; no further replacement steps were applied."
                );
            }
        },
        remove: (index, length) => deleteObservedAction(ctx, index, length),
        move: (from, to, length) => moveActionToIndex(ctx, from, to, length),
        async populate(index, length, stage, desired) {
            await open(index, length);
            await writeOpenAction(ctx, desired, {
                current: stage,
                resolveItem: sync.resolveItem,
                apply: {
                    markHeaderApplied: () => undefined,
                    shouldApplyList: (prop) => prop !== "conditions",
                    applyConditions: async () => {
                        throw new Error(
                            "A verified conditional predicate cannot be rewritten while populating actions."
                        );
                    },
                    applyChildActions: (_prop, args) =>
                        appendActionsToOpenActionList(
                            ctx,
                            args.desired,
                            sync.resolveItem
                        ),
                },
            });
            await clickGoBack(ctx);
        },
        async finishNote(index, length, note) {
            const slot = await getPaginatedListSlotAtIndex(
                ctx,
                index,
                length,
                ACTION_LIST_CONFIG
            );
            await setListItemNote(ctx, slot, note);
        },
    };
}
