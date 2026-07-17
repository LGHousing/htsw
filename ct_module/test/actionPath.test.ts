import { describe, expect, test } from "vitest";
import type { Action } from "htsw/types";

import {
    ActionPath,
    ActionListPath,
    ActionTreePath,
    ConditionListPath,
} from "../src/housingSync/actionPath";

describe("action paths", () => {
    test("builds typed nested action and list paths", () => {
        const root = ActionListPath.root();
        const parent = ActionPath.at(root, 5);
        const ifActions = ActionListPath.childOf(parent, "ifActions");
        const child = ActionPath.at(ifActions, 2);

        expect(ActionPath.key(parent)).toBe("5");
        expect(ActionTreePath.key(root)).toBe("");
        expect(ActionTreePath.key(ifActions)).toBe("5.ifActions");
        expect(ActionPath.key(child)).toBe("5.ifActions.2");
        expect(ActionPath.depth(child)).toBe(1);
        expect(ActionPath.containingList(child)).toEqual(ifActions);
        expect(ActionTreePath.parentAction(child)).toEqual(parent);
        expect(ActionTreePath.parentAction(ifActions)).toEqual(parent);
    });

    test("keeps condition lists distinct from action lists", () => {
        const parent = ActionPath.at(undefined, 1);
        const conditions = ConditionListPath.of(parent, "conditions");

        expect(ActionTreePath.key(conditions)).toBe("1.conditions");
        expect(ActionTreePath.nearestAction(conditions)).toEqual(parent);
        expect(
            ActionTreePath.equals(conditions, ConditionListPath.of(parent, "conditions"))
        ).toBe(true);
        expect(
            ActionTreePath.equals(conditions, ActionListPath.childOf(parent, "actions"))
        ).toBe(false);
    });

    test("checks subtree membership by parts instead of string prefixes", () => {
        const parent = ActionPath.fromParts([1]);
        const child = ActionPath.fromParts([1, "ifActions", 0]);
        const lookalike = ActionPath.fromParts([10]);

        expect(ActionTreePath.isWithinAction(child, parent)).toBe(true);
        expect(
            ActionTreePath.isWithinAction(
                ConditionListPath.of(parent, "conditions"),
                parent
            )
        ).toBe(true);
        expect(ActionTreePath.isWithinAction(lookalike, parent)).toBe(false);
        expect(ActionPath.equals(parent, ActionPath.fromParts([1]))).toBe(true);
    });

    test("resolves actions without parsing a serialized key", () => {
        const actions: Action[] = [
            {
                type: "CONDITIONAL",
                matchAny: false,
                conditions: [],
                ifActions: [
                    {
                        type: "RANDOM",
                        actions: [{ type: "EXIT" }],
                    },
                ],
                elseActions: [],
            },
        ];

        expect(ActionPath.resolve(actions, ActionPath.fromParts([0]))?.type).toBe(
            "CONDITIONAL"
        );
        expect(
            ActionPath.resolve(actions, ActionPath.fromParts([0, "ifActions", 0]))?.type
        ).toBe("RANDOM");
        expect(
            ActionPath.resolve(
                actions,
                ActionPath.fromParts([0, "ifActions", 0, "actions", 0])
            )?.type
        ).toBe("EXIT");
    });

    test("rejects malformed part sequences", () => {
        expect(() => ActionPath.fromParts([])).toThrow();
        expect(() => ActionPath.fromParts([0, "ifActions"])).toThrow();
        expect(() => ActionPath.fromParts([0, 1, 2])).toThrow();
    });
});
