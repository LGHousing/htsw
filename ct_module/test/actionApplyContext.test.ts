import { describe, expect, test, vi } from "vitest";
import type { Condition } from "htsw/types";

import type TaskContext from "../src/tasks/context";
import { createActionApplyContext } from "../src/housingSync/context/actionApplyContext";
import { ActionPath } from "../src/housingSync/actionPath";
import {
    baselineActionListFromSlots,
    diffActionList,
} from "../src/housingSync/actions/diff";
import type {
    ActionListOperation,
    ChildActionListDiff,
    ConditionListDiff,
} from "../src/housingSync/actions/diff/types";
import type { PlannedChildActionList } from "../src/housingSync/actions/apply/types";

import { conditional, message, observedSlot } from "./utils";

describe("createActionApplyContext", () => {
    test("passes planned child diffs to apply by identity", async () => {
        const observedCondition = { type: "IS_SNEAKING" } as Condition;
        const desiredCondition = { type: "IS_FLYING" } as Condition;
        const observed = conditional({
            conditions: [observedCondition],
            ifActions: [message("before")],
        });
        const desired = conditional({
            conditions: [desiredCondition],
            ifActions: [message("after")],
        });
        const rootDiff = diffActionList(
            baselineActionListFromSlots([observedSlot(0, observed)]),
            [desired]
        );
        const edit = rootDiff.operations[0] as Extract<
            ActionListOperation,
            { kind: "edit" }
        >;
        const actionDiff = edit.childListDiffs.find(
            (child) => child.kind === "actions"
        );
        const conditionDiff = edit.childListDiffs.find(
            (child) => child.kind === "conditions"
        );
        if (
            actionDiff?.kind !== "actions" ||
            conditionDiff?.kind !== "conditions"
        ) {
            throw new Error("Expected both child-list diffs.");
        }

        let receivedActionDiff: ChildActionListDiff | undefined;
        let receivedConditionDiff: ConditionListDiff | undefined;
        const applyChildActions = async (
            _ctx: TaskContext,
            plan: PlannedChildActionList
        ): Promise<void> => {
            receivedActionDiff = plan.diff;
        };
        const applyConditions = async (
            _ctx: TaskContext,
            _observedCount: number,
            diff: ConditionListDiff
        ): Promise<void> => {
            receivedConditionDiff = diff;
        };
        const apply = createActionApplyContext({
            ctx: null as never,
            actionPath: ActionPath.at(undefined, 0),
            sync: {
                events: undefined,
                resolveItem: vi.fn(),
            } as never,
            appliedUnits: 0,
            completedOps: 0,
            totalOps: 1,
            childListDiffs: edit.childListDiffs,
            applyChildActions,
            applyConditions,
        });

        await apply.applyChildActions("ifActions", {
            desired: desired.ifActions,
            observed: observed.ifActions,
        });
        await apply.applyConditions("conditions", {
            desired: desired.conditions,
            observed: observed.conditions,
        });

        expect(receivedActionDiff).toBe(actionDiff.diff);
        expect(receivedConditionDiff).toBe(conditionDiff.diff);
    });
});
