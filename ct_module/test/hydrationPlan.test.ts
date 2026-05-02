import { strict as assert } from "node:assert";
import type { Action, Condition } from "htsw/types";

import { createNestedHydrationPlan } from "../src/importer/actions/hydrationPlan";
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

function plannedIndexes(plan: ReturnType<typeof createNestedHydrationPlan>): number[] {
    return [...plan.keys()].map((entry) => entry.index).sort((a, b) => a - b);
}

{
    const plan = createNestedHydrationPlan(
        [
            observed(0, { conditions: ["REQUIRE_ITEM"] }),
            observed(1, { conditions: ["REQUIRE_ITEM"] }),
            observed(2, { conditions: ["REQUIRE_ITEM"] }),
        ],
        [{ type: "MESSAGE", message: "hello" }]
    );
    assert.deepEqual(plannedIndexes(plan), []);
}

{
    const observedActions = Array.from({ length: 20 }, (_, index) =>
        observed(index, {
            conditions: [index === 8 || index === 14 ? "REQUIRE_ITEM" : "REQUIRE_TEAM"],
            ifActions: Array.from({ length: index === 14 ? 2 : 1 }, () => "CHANGE_VAR"),
            elseActions: [],
        })
    );
    const plan = createNestedHydrationPlan(observedActions, [
        desired(["REQUIRE_ITEM"], ["CHANGE_VAR"]),
        desired(["REQUIRE_ITEM"], ["CHANGE_VAR", "CHANGE_VAR"]),
    ]);
    assert.deepEqual(plannedIndexes(plan), [8, 14]);
}

{
    const observedActions = Array.from({ length: 20 }, (_, index) =>
        observed(index, { conditions: ["REQUIRE_ITEM"], ifActions: ["CHANGE_VAR"] })
    );
    const desiredActions = Array.from({ length: 20 }, () =>
        desired(["REQUIRE_ITEM"], ["CHANGE_VAR"])
    );
    const plan = createNestedHydrationPlan(observedActions, desiredActions);
    assert.equal(plan.size, 20);
}

{
    const entry = observed(0, { conditions: ["REQUIRE_ITEM"], elseActions: [] });
    const plan = createNestedHydrationPlan(
        [entry],
        [desired(["REQUIRE_ITEM"], ["CHANGE_VAR"])]
    );
    assert.deepEqual([...(plan.get(entry) ?? new Set())].sort(), ["conditions"]);
}

{
    const known = observed(0, { conditions: ["REQUIRE_ITEM"] });
    const unknown = observed(1, { conditions: ["UNKNOWN"] });
    const plan = createNestedHydrationPlan(
        [unknown, known],
        [desired(["REQUIRE_ITEM"], [])]
    );
    assert.deepEqual(plannedIndexes(plan), [0]);
}

{
    const wrongMatchAny = observed(
        0,
        { conditions: ["REQUIRE_ITEM"] },
        { matchAny: true }
    );
    const rightMatchAny = observed(1, { conditions: ["REQUIRE_ITEM"] });
    const plan = createNestedHydrationPlan(
        [wrongMatchAny, rightMatchAny],
        [desired(["REQUIRE_ITEM"], [])]
    );
    assert.deepEqual(plannedIndexes(plan), [1]);
}

{
    const plan = createNestedHydrationPlan(
        [
            observed(0, { conditions: ["REQUIRE_ITEM"] }),
            observed(1, { conditions: ["REQUIRE_ITEM"] }),
        ],
        [desired(["REQUIRE_ITEM"], [])]
    );
    assert.deepEqual(plannedIndexes(plan), [0]);
}
