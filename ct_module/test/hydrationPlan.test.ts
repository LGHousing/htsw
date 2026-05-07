import { describe, expect, test } from "vitest";
import type { Action, Condition } from "htsw/types";

import { createNestedHydrationPlan } from "../src/importer/actions/hydrationPlan";
import { matchObservedToDesired } from "../src/importer/actions/nestedMatching";
import type {
    NestedListProp,
    NestedPropsToRead,
    ObservedActionSlot,
} from "../src/importer/types";

function observed(
    index: number,
    nestedSummaries: Partial<Record<NestedListProp, string[]>>,
    fields: Partial<NonNullable<ObservedActionSlot["action"]>> = {}
): ObservedActionSlot {
    const nestedPropsToRead: NestedPropsToRead = new Set();
    for (const prop of ["conditions", "ifActions", "elseActions", "actions"] as const) {
        if ((nestedSummaries[prop] ?? []).length > 0) {
            nestedPropsToRead.add(prop);
        }
    }

    return {
        index,
        slotId: index,
        slot: null as never,
        action: {
            type: "CONDITIONAL",
            matchAny: false,
            conditions: [],
            ifActions: [],
            elseActions: [],
            ...fields,
        } as NonNullable<ObservedActionSlot["action"]>,
        nestedReadState: "summary",
        nestedSummaries,
        nestedPropsToRead,
    };
}

function desired(
    conditions: string[],
    ifActions: string[],
    fields: Partial<Action> = {}
): Action {
    return {
        type: "CONDITIONAL",
        matchAny: false,
        conditions: conditions.map((type) => ({ type }) as Condition),
        ifActions: ifActions.map((type) => ({ type }) as Action),
        elseActions: [],
        ...fields,
    } as Action;
}

function plan(observedList: ObservedActionSlot[], desiredList: Action[]) {
    return createNestedHydrationPlan(matchObservedToDesired(observedList, desiredList));
}

function plannedIndexes(p: ReturnType<typeof plan>): number[] {
    const out: number[] = [];
    for (const slot of p.keys()) out.push(slot.index);
    return out.sort((a, b) => a - b);
}

describe("createNestedHydrationPlan", () => {
    test("no matchable desired => empty plan", () => {
        const result = plan(
            [
                observed(0, { conditions: ["REQUIRE_ITEM"] }),
                observed(1, { conditions: ["REQUIRE_ITEM"] }),
                observed(2, { conditions: ["REQUIRE_ITEM"] }),
            ],
            [{ type: "MESSAGE", message: "hello" }]
        );
        expect(plannedIndexes(result)).toEqual([]);
    });

    test("picks the cheapest observed slots out of many candidates", () => {
        // 20 observed CONDITIONALs, mostly with mismatched condition types.
        // Slots 8 and 14 have nested shapes that match the two desired
        // entries, so the matcher should pair them.
        const observedActions = Array.from({ length: 20 }, (_, index) =>
            observed(index, {
                conditions: [index === 8 || index === 14 ? "REQUIRE_ITEM" : "REQUIRE_TEAM"],
                ifActions: Array.from({ length: index === 14 ? 2 : 1 }, () => "CHANGE_VAR"),
                elseActions: [],
            })
        );
        const result = plan(observedActions, [
            desired(["REQUIRE_ITEM"], ["CHANGE_VAR"]),
            desired(["REQUIRE_ITEM"], ["CHANGE_VAR", "CHANGE_VAR"]),
        ]);
        expect(plannedIndexes(result)).toEqual([8, 14]);
    });

    test("matches all 20 when observed and desired are aligned", () => {
        const observedActions = Array.from({ length: 20 }, (_, index) =>
            observed(index, { conditions: ["REQUIRE_ITEM"], ifActions: ["CHANGE_VAR"] })
        );
        const desiredActions = Array.from({ length: 20 }, () =>
            desired(["REQUIRE_ITEM"], ["CHANGE_VAR"])
        );
        const result = plan(observedActions, desiredActions);
        expect(result.size).toBe(20);
    });

    test("hydrates only the props that have non-empty summaries", () => {
        const entry = observed(0, { conditions: ["REQUIRE_ITEM"], elseActions: [] });
        const result = plan([entry], [desired(["REQUIRE_ITEM"], ["CHANGE_VAR"])]);
        const props = Array.from(result.get(entry) ?? new Set<string>()).sort();
        expect(props).toEqual(["conditions"]);
    });

    test("prefers the slot whose summary already shapes-up to the desired", () => {
        // The "known" slot's condition matches the desired; the "unknown"
        // slot's doesn't. The matcher should pick the known one.
        const known = observed(0, { conditions: ["REQUIRE_ITEM"] });
        const unknown = observed(1, { conditions: ["UNKNOWN"] });
        const result = plan([unknown, known], [desired(["REQUIRE_ITEM"], [])]);
        expect(plannedIndexes(result)).toEqual([0]);
    });

    test("scalar field mismatches contribute to cost (matchAny picks the right slot)", () => {
        const wrongMatchAny = observed(
            0,
            { conditions: ["REQUIRE_ITEM"] },
            { matchAny: true }
        );
        const rightMatchAny = observed(1, { conditions: ["REQUIRE_ITEM"] });
        const result = plan(
            [wrongMatchAny, rightMatchAny],
            [desired(["REQUIRE_ITEM"], [])]
        );
        expect(plannedIndexes(result)).toEqual([1]);
    });

    test("when two slots are tied, the lower-index one wins (deterministic tie-break)", () => {
        const result = plan(
            [
                observed(0, { conditions: ["REQUIRE_ITEM"] }),
                observed(1, { conditions: ["REQUIRE_ITEM"] }),
            ],
            [desired(["REQUIRE_ITEM"], [])]
        );
        expect(plannedIndexes(result)).toEqual([0]);
    });
});
