import { describe, expect, test } from "vitest";
import type { Action } from "htsw/types";

import {
    actionAtPath,
    actionListForAction,
    actionPathDepth,
    actionPathEquals,
    actionPathForIndex,
    actionPathFromParts,
    actionPathKey,
    actionTreePathEquals,
    actionTreePathKey,
    childActionListPath,
    conditionListPath,
    isPathWithinAction,
    nearestActionPath,
    parentActionPath,
    rootActionListPath,
} from "../src/housingSync/actionPath";

describe("action paths", () => {
    test("builds typed nested action and list paths", () => {
        const root = rootActionListPath();
        const parent = actionPathForIndex(root, 5);
        const ifActions = childActionListPath(parent, "ifActions");
        const child = actionPathForIndex(ifActions, 2);

        expect(actionPathKey(parent)).toBe("5");
        expect(actionTreePathKey(root)).toBe("");
        expect(actionTreePathKey(ifActions)).toBe("5.ifActions");
        expect(actionPathKey(child)).toBe("5.ifActions.2");
        expect(actionPathDepth(child)).toBe(1);
        expect(actionListForAction(child)).toEqual(ifActions);
        expect(parentActionPath(child)).toEqual(parent);
        expect(parentActionPath(ifActions)).toEqual(parent);
    });

    test("keeps condition lists distinct from action lists", () => {
        const parent = actionPathForIndex(undefined, 1);
        const conditions = conditionListPath(parent);

        expect(actionTreePathKey(conditions)).toBe("1.conditions");
        expect(nearestActionPath(conditions)).toEqual(parent);
        expect(actionTreePathEquals(conditions, conditionListPath(parent))).toBe(true);
        expect(actionTreePathEquals(conditions, childActionListPath(parent, "actions"))).toBe(false);
    });

    test("checks subtree membership by parts instead of string prefixes", () => {
        const parent = actionPathFromParts([1]);
        const child = actionPathFromParts([1, "ifActions", 0]);
        const lookalike = actionPathFromParts([10]);

        expect(isPathWithinAction(child, parent)).toBe(true);
        expect(isPathWithinAction(conditionListPath(parent), parent)).toBe(true);
        expect(isPathWithinAction(lookalike, parent)).toBe(false);
        expect(actionPathEquals(parent, actionPathFromParts([1]))).toBe(true);
    });

    test("resolves actions without parsing a serialized key", () => {
        const actions: Action[] = [{
            type: "CONDITIONAL",
            matchAny: false,
            conditions: [],
            ifActions: [{
                type: "RANDOM",
                actions: [{ type: "EXIT" }],
            }],
            elseActions: [],
        }];

        expect(actionAtPath(actions, actionPathFromParts([0]))?.type).toBe("CONDITIONAL");
        expect(actionAtPath(actions, actionPathFromParts([0, "ifActions", 0]))?.type).toBe("RANDOM");
        expect(actionAtPath(
            actions,
            actionPathFromParts([0, "ifActions", 0, "actions", 0])
        )?.type).toBe("EXIT");
    });

    test("rejects malformed part sequences", () => {
        expect(() => actionPathFromParts([])).toThrow();
        expect(() => actionPathFromParts([0, "ifActions"])).toThrow();
        expect(() => actionPathFromParts([0, 1, 2])).toThrow();
    });
});
