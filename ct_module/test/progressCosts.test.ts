import { describe, expect, test } from "vitest";
import type {
    Action,
    Condition,
    ImportableFunction,
    ImportableItem,
    ImportableMenu,
    ImportableRegion,
    ImportableCommand,
} from "htsw/types";

import {
    actionOperationApplyUnits,
    actionListDiffApplyUnits,
    actionListOperationApplyUnits,
    conditionListDiffApplyUnits,
    conditionOperationUnits,
    estimateConditionListPhaseUnits,
    estimateImportableCost,
    estimateImportableReadUnits,
    estimateImportableUnits,
    exactHydrationPlanUnits,
    hydrationEntryUnits,
    COST,
    ITEM_CAPTURE_FIELD_UNITS,
    REGION_BOUNDS_CHANGE_UNITS,
    editUnitsWithChildLists,
} from "../src/housingSync/progress/costs";
import {
    baselineActionListFromActions,
    diffActionList,
} from "../src/housingSync/actions/diff";
import {
    baselineConditionListFromConditions,
    diffConditionList,
} from "../src/housingSync/actions/conditions/diff";
import type {
    ActionHydrationPlan,
    ActionHydrationWork,
} from "../src/housingSync/actions/hydration/plan";
import type {
    ActionListOperation,
    ConditionListOperation,
} from "../src/housingSync/actions/diff/types";
import type { ObservedActionSlot } from "../src/housingSync/observedActions";
import type { ImportableCacheEntry } from "../src/importCache/cache";

import { conditional, message, observedSlot } from "./utils";

describe("progress cost estimates", () => {
    test("condition note-only edits charge one note edit", () => {
        const baseline = { type: "IS_SNEAKING", note: "old" } as Condition;
        const desired = { type: "IS_SNEAKING", note: "new" } as Condition;
        const op: Extract<ConditionListOperation, { kind: "edit" }> = {
            kind: "edit",
            entryId: 0,
            baselineCondition: baseline,
            desired,
            noteOnly: true,
        };

        expect(conditionOperationUnits(op)).toBe(
            COST.anvilInput + COST.menuClickWait
        );
    });

    test("action note-only edits charge one note edit", () => {
        const op: Extract<ActionListOperation, { kind: "edit" }> = {
            kind: "edit",
            entryId: 0,
            fromIndex: 0,
            desiredIndex: 0,
            baselineAction: message("hi", { note: "old" }),
            desired: message("hi", { note: "new" }),
            noteOnly: true,
            noteDiffers: true,
            childListDiffs: [],
        };

        expect(actionOperationApplyUnits(op, () => 0, 1)).toBe(
            COST.anvilInput + COST.menuClickWait
        );
    });

    test("building an action list from empty charges no reorder steps", () => {
        const desired = Array.from({ length: 13 }, (_, i) => message(`m${i}`));
        const diff = diffActionList(baselineActionListFromActions([]), desired);
        const units = actionListOperationApplyUnits(
            diff,
            editUnitsWithChildLists,
            desired.length
        );
        const adds = diff.operations.filter((op) => op.kind === "add");

        for (const op of adds) {
            expect(units.get(op)).toBe(
                actionOperationApplyUnits(op, editUnitsWithChildLists, op.toIndex)
            );
        }
    });

    test("adding into an existing middle position charges the real walk", () => {
        const add: Extract<ActionListOperation, { kind: "add" }> = {
            kind: "add",
            desiredIndex: 1,
            toIndex: 1,
            desired: message("middle"),
            childListDiffs: [],
        };
        const diff = { operations: [add], desiredLength: 3 };
        const units = actionListOperationApplyUnits(
            diff,
            editUnitsWithChildLists,
            3
        );
        const withoutWalk = actionOperationApplyUnits(
            { ...add, desiredIndex: 2, toIndex: 2 },
            editUnitsWithChildLists,
            2
        );

        expect(units.get(add)! - withoutWalk).toBeCloseTo(COST.reorderStep);
    });

    test("parent add and nested run use the same child action diff price", () => {
        const child = Array.from({ length: 13 }, (_, i) => message(`child ${i}`));
        const emptyParent = conditional({ ifActions: [] });
        const parentWithChild = conditional({ ifActions: child });
        const emptyDiff = diffActionList(
            baselineActionListFromActions([]),
            [emptyParent]
        );
        const childDiff = diffActionList(baselineActionListFromActions([]), child);
        const parentDiff = diffActionList(
            baselineActionListFromActions([]),
            [parentWithChild]
        );
        const childTotal = actionListDiffApplyUnits(
            childDiff,
            editUnitsWithChildLists,
            child.length
        );

        expect(
            actionListDiffApplyUnits(
                parentDiff,
                editUnitsWithChildLists,
                1
            ) -
                actionListDiffApplyUnits(
                    emptyDiff,
                    editUnitsWithChildLists,
                    1
                )
        ).toBeCloseTo(COST.menuClickWait + childTotal + COST.goBackWait);
    });

    test("added condition child lists include open and return waits", () => {
        const conditions = [{ type: "IS_SNEAKING" }] as Condition[];
        const emptyParent = conditional({ conditions: [] });
        const parentWithConditions = conditional({ conditions });
        const emptyDiff = diffActionList(
            baselineActionListFromActions([]),
            [emptyParent]
        );
        const parentDiff = diffActionList(
            baselineActionListFromActions([]),
            [parentWithConditions]
        );
        const nestedTotal = conditionListDiffApplyUnits(
            diffConditionList(
                baselineConditionListFromConditions([]),
                conditions
            )
        );

        expect(
            actionListDiffApplyUnits(
                parentDiff,
                editUnitsWithChildLists,
                1
            ) -
                actionListDiffApplyUnits(
                    emptyDiff,
                    editUnitsWithChildLists,
                    1
                )
        ).toBeCloseTo(COST.menuClickWait + nestedTotal + COST.goBackWait);
    });

    test("item field writes include picker open, selection, and injection", () => {
        const add: Extract<ActionListOperation, { kind: "add" }> = {
            kind: "add",
            desiredIndex: 0,
            toIndex: 0,
            desired: { type: "GIVE_ITEM", itemName: "Key" },
            childListDiffs: [],
        };
        expect(
            actionOperationApplyUnits(add, editUnitsWithChildLists, 0)
        ).toBe(
            COST.menuClickWait * 2 +
                COST.menuClickWait +
                COST.itemSelect +
                COST.itemInject +
                COST.goBackWait
        );
    });

    test("a two-option cycle change costs one click", () => {
        const baseline = {
            type: "FISHING_ENVIRONMENT",
            environment: "Water",
        } as Condition;
        const desired = {
            type: "FISHING_ENVIRONMENT",
            environment: "Lava",
        } as Condition;
        const op: Extract<ConditionListOperation, { kind: "edit" }> = {
            kind: "edit",
            entryId: 0,
            baselineCondition: baseline,
            desired,
            noteOnly: false,
        };

        expect(conditionOperationUnits(op)).toBe(
            COST.menuClickWait + COST.menuClickWait + COST.goBackWait
        );
    });

    test("delete on page three includes the walk there and final reset", () => {
        const op: Extract<ActionListOperation, { kind: "delete" }> = {
            kind: "delete",
            entryId: 42,
            fromIndex: 42,
            baselineAction: message("last"),
        };
        const units = actionListOperationApplyUnits(
            { operations: [op], desiredLength: 42 },
            editUnitsWithChildLists,
            42
        );

        expect(units.get(op)).toBe(
            COST.pageTurnWait * 4 + COST.menuClickWait
        );
    });

    test("move pricing resolves its index after an earlier delete", () => {
        const baseline = [
            message("X"),
            message("A"),
            message("B"),
            message("C"),
        ];
        const desired = [message("C"), message("A"), message("B")];
        const diff = diffActionList(baselineActionListFromActions(baseline), desired);
        const move = diff.operations.find(
            (op): op is Extract<ActionListOperation, { kind: "move" }> =>
                op.kind === "move"
        )!;
        const units = actionListOperationApplyUnits(
            diff,
            editUnitsWithChildLists,
            desired.length
        );

        expect(units.get(move)).toBe(COST.reorderStep);
    });

    test("menu estimate prices each slot as an editor round-trip plus its list", () => {
        const menuWith = (actions: Action[]): ImportableMenu => ({
            type: "MENU",
            name: "m",
            slots: [{ slot: 0, nbt: null as never, actions }],
        });

        const emptySlot = estimateImportableCost(menuWith([]));
        // Entering and leaving a slot's action editor costs two menu waits —
        // far more than the single click the old estimate charged.
        expect(emptySlot).toBeGreaterThanOrEqual(COST.menuClickWait + COST.goBackWait);

        const withChildren = estimateImportableCost(
            menuWith([conditional({ ifActions: [message("a"), message("b")] })])
        );
        expect(withChildren).toBeGreaterThan(emptySlot);
    });

    test("menu slot actions include their apply work", () => {
        const actions = [message("a"), message("b"), message("c")];
        const withoutActions: ImportableMenu = {
            type: "MENU",
            name: "m",
            slots: [{ slot: 0, nbt: null as never, actions: [] }],
        };
        const withActions: ImportableMenu = {
            ...withoutActions,
            slots: [{ slot: 0, nbt: null as never, actions }],
        };
        const actionApply = actionListDiffApplyUnits(
            diffActionList(baselineActionListFromActions([]), actions),
            editUnitsWithChildLists,
            actions.length
        );

        expect(
            estimateImportableCost(withActions) -
                estimateImportableCost(withoutActions)
        ).toBeCloseTo(actionApply);
    });

    test("items with click actions price both guaranteed sleeps", () => {
        const item: ImportableItem = {
            type: "ITEM",
            name: "wand",
            nbt: null as never,
            leftClickActions: [message("click")],
        };
        const expectedWithoutActionList =
            COST.itemInject +
            COST.guaranteedSleep1000 * 2 +
            COST.commandInterval +
            COST.commandMenuWait +
            COST.menuClickWait +
            COST.nbtCapture +
            COST.cacheWrite;

        expect(estimateImportableCost(item)).toBeCloseTo(
            expectedWithoutActionList +
                actionListDiffApplyUnits(
                    diffActionList(
                        baselineActionListFromActions([]),
                        item.leftClickActions ?? []
                    ),
                    editUnitsWithChildLists,
                    1
                )
        );
    });

    test("codeless items still price placement and its held-item wait", () => {
        const item: ImportableItem = {
            type: "ITEM",
            name: "plain",
            nbt: null as never,
        };
        expect(estimateImportableCost(item)).toBeCloseTo(
            COST.itemInject + COST.guaranteedSleep1000 + COST.cacheWrite
        );
    });

    test("items with reusable interact data only price placement", () => {
        const item: ImportableItem = {
            type: "ITEM",
            name: "cached wand",
            nbt: null as never,
            leftClickActions: [message("click")],
        };
        expect(estimateImportableUnits(item, null, false, true)).toBeCloseTo(
            COST.itemInject + COST.guaranteedSleep1000 + COST.cacheWrite
        );
    });

    test("region bounds work is omitted only when a trusted baseline matches", () => {
        const changed: ImportableRegion = {
            type: "REGION",
            name: "r",
            bounds: { from: { x: 1, y: 2, z: 3 }, to: { x: 4, y: 5, z: 6 } },
            onEnterActions: [],
            onExitActions: [],
        };
        const matching = changed;
        const old: ImportableRegion = {
            ...changed,
            bounds: { from: { x: 0, y: 0, z: 0 }, to: { x: 4, y: 5, z: 6 } },
        };
        const cache = (importable: ImportableRegion): ImportableCacheEntry =>
            ({
                importable,
                lists: {},
            }) as ImportableCacheEntry;

        expect(
            estimateImportableUnits(changed, cache(old), true) -
                estimateImportableUnits(matching, cache(matching), true)
        ).toBeCloseTo(REGION_BOUNDS_CHANGE_UNITS);
    });

    test("trusted command settings price only fields that differ", () => {
        const desired: ImportableCommand = {
            type: "COMMAND",
            name: "test",
            actions: [],
            mode: "Targeted",
            requiredPriority: 4,
            listed: false,
        };
        const matching = {
            ...desired,
        };
        const oneDifference = {
            ...desired,
            requiredPriority: 0,
        };
        const cache = (importable: ImportableCommand): ImportableCacheEntry =>
            ({
                importable,
                lists: {},
            }) as ImportableCacheEntry;

        expect(
            estimateImportableUnits(desired, cache(oneDifference), true) -
                estimateImportableUnits(desired, cache(matching), true)
        ).toBeCloseTo(COST.signInput);
    });

    test("unrelated function action pricing only gains its command interval", () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "f",
            actions: [message("hi")],
        };
        expect(estimateImportableCost(importable)).toBeCloseTo(
            COST.commandInterval +
                COST.commandMenuWait +
                actionListDiffApplyUnits(
                    diffActionList(
                        baselineActionListFromActions([]),
                        importable.actions ?? []
                    ),
                    editUnitsWithChildLists,
                    1
                ) +
                COST.cacheWrite
        );
    });

    test("function read estimate prices its list walk without apply work", () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "f",
            actions: [conditional({ ifActions: [message("a")] })],
        };

        expect(estimateImportableReadUnits(importable)).toBeCloseTo(
            COST.commandInterval +
                COST.commandMenuWait +
                COST.menuClickWait +
                (COST.menuClickWait +
                    COST.goBackWait +
                    COST.menuClickWait +
                    COST.goBackWait) +
                COST.goBackWait +
                COST.menuClickWait +
                COST.goBackWait +
                COST.cacheWrite
        );
    });

    test("function read estimate includes one item field hydration", () => {
        const withoutItem: ImportableFunction = {
            type: "FUNCTION",
            name: "f",
            actions: [message("hi")],
        };
        const withItem: ImportableFunction = {
            type: "FUNCTION",
            name: "f",
            actions: [{ type: "GIVE_ITEM", itemName: "Key" }],
        };

        expect(
            estimateImportableReadUnits(withItem) -
                estimateImportableReadUnits(withoutItem)
        ).toBeCloseTo(
            COST.menuClickWait + COST.goBackWait + ITEM_CAPTURE_FIELD_UNITS
        );
    });

    test("function read estimate includes several item field hydrations", () => {
        const withoutItems: ImportableFunction = {
            type: "FUNCTION",
            name: "f",
            actions: [message("a"), message("b"), message("c")],
        };
        const withItems: ImportableFunction = {
            type: "FUNCTION",
            name: "f",
            actions: [
                { type: "GIVE_ITEM", itemName: "A" },
                { type: "REMOVE_ITEM", itemName: "B" },
                { type: "DROP_ITEM", itemName: "C" } as Action,
            ],
        };

        expect(
            estimateImportableReadUnits(withItems) -
                estimateImportableReadUnits(withoutItems)
        ).toBeCloseTo(
            3 * (COST.menuClickWait + COST.goBackWait + ITEM_CAPTURE_FIELD_UNITS)
        );
    });

    test("several item fields on one action share its editor round trip", () => {
        const entry = observedSlot(0, message("hi"));
        const work: ActionHydrationWork = {
            childListsToRead: new Set(),
            scalarFieldsToRead: [],
            itemFieldsToCapture: [
                { label: "First", prop: "first" },
                { label: "Second", prop: "second" },
                { label: "Third", prop: "third" },
            ],
        };

        expect(hydrationEntryUnits(entry, work)).toBeCloseTo(
            COST.menuClickWait + COST.goBackWait + 3 * ITEM_CAPTURE_FIELD_UNITS
        );
    });

    test("condition list estimate includes item-bearing condition hydration", () => {
        const withoutItems = [
            { type: "IS_SNEAKING" },
            { type: "IS_FLYING" },
        ] as Condition[];
        const withItems = [
            { type: "REQUIRE_ITEM", itemName: "A" },
            { type: "BLOCK_TYPE", itemName: "B" },
        ] as Condition[];

        expect(
            estimateConditionListPhaseUnits(withItems, withItems).reading -
                estimateConditionListPhaseUnits(withoutItems, withoutItems).reading
        ).toBeCloseTo(
            2 * (COST.menuClickWait + COST.goBackWait + ITEM_CAPTURE_FIELD_UNITS)
        );
    });

    test("item-free function read estimate keeps its existing units", () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "f",
            actions: [message("hi")],
        };

        expect(estimateImportableReadUnits(importable)).toBeCloseTo(
            COST.commandInterval +
                COST.commandMenuWait +
                COST.menuClickWait +
                COST.goBackWait +
                COST.menuClickWait +
                COST.goBackWait +
                COST.cacheWrite
        );
    });

    test("exact hydration plan pricing excludes speculative child-row scalar reads", () => {
        const entry: ObservedActionSlot = {
            ...observedSlot(0, conditional()),
            childListSummaries: { ifActions: ["MESSAGE"] },
        };
        const work: ActionHydrationWork = {
            childListsToRead: new Set(["ifActions"] as const),
            scalarFieldsToRead: [],
            itemFieldsToCapture: [],
        };
        const plan: ActionHydrationPlan = new Map([[entry, work]]);

        expect(exactHydrationPlanUnits(plan)).toBeCloseTo(
            COST.menuClickWait * 2 + COST.goBackWait * 2
        );
        expect(hydrationEntryUnits(entry, work)).toBeGreaterThan(
            exactHydrationPlanUnits(plan)
        );
    });
});
