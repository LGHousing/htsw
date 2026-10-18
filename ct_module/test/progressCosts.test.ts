import { describe, expect, test } from "vitest";
import type {
    Action,
    Condition,
    ImportableFunction,
    ImportableItem,
    ImportableMenu,
    ImportableRegion,
    ImportableCommand,
    Importable,
} from "htsw/types";
import type { Tag } from "htsw/nbt";

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
import { listHashes } from "../src/importCache/hash";
import { createItemDependencyIndex } from "../src/importables/items/dependencyIndex";
import { createProjectItemIndex } from "../src/importables/items/projectItems";

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

    test("item field writes defer conditional injection to runtime", () => {
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

    test("items with click actions omit the replaced fixed sleeps", () => {
        const item: ImportableItem = {
            type: "ITEM",
            name: "wand",
            nbt: null as never,
            leftClickActions: [message("click")],
        };
        const expectedWithoutActionList =
            COST.itemInject +
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

    test("codeless items price placement without a fixed sleep", () => {
        const item: ImportableItem = {
            type: "ITEM",
            name: "plain",
            nbt: null as never,
        };
        expect(estimateImportableCost(item)).toBeCloseTo(
            COST.itemInject + COST.cacheWrite
        );
    });

    test("ITEM reading has no fixed one-second signing sleep", () => {
        const item: ImportableItem = {
            type: "ITEM", name: "wand", nbt: null as never,
            leftClickActions: [message("click")],
        };
        expect(estimateImportableReadUnits(item)).toBeCloseTo(
            COST.commandMenuWait + COST.menuClickWait +
            2 * (COST.menuClickWait + COST.goBackWait) + COST.nbtCapture + COST.cacheWrite
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
            COST.itemInject + COST.cacheWrite
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

    test("trusted menu prices only the slots that differ from the cache", () => {
        const nbt = { type: "compound", value: {} } as never;
        const menuWith = (sell: string): ImportableMenu => ({
            type: "MENU",
            name: "m",
            slots: [
                { slot: 0, nbt },
                { slot: 1, nbt },
                { slot: 4, nbt, actions: [message("buy")] },
                { slot: 5, nbt, actions: [message(sell)] },
            ],
        });
        const cache = (importable: ImportableMenu): ImportableCacheEntry =>
            ({
                importable,
                lists: {},
            }) as ImportableCacheEntry;
        const snapshot =
            COST.commandMenuWait + COST.menuClickWait;
        const editOneMessage = actionListDiffApplyUnits(
            diffActionList(baselineActionListFromActions([message("old")]), [
                message("new"),
            ]),
            editUnitsWithChildLists,
            1
        );

        // One grid snapshot, the changed slot's lock check, reopen for the
        // apply, one slot's edit. No unchanged slot is opened.
        expect(
            estimateImportableUnits(menuWith("new"), cache(menuWith("old")), true)
        ).toBeCloseTo(
            snapshot * 2 +
                (COST.commandMenuWait + COST.menuClickWait * 2) +
                COST.menuClickWait +
                editOneMessage +
                COST.goBackWait +
                COST.cacheWrite
        );
        // Trust off opens all four cached slots to read them.
        expect(
            estimateImportableUnits(menuWith("new"), cache(menuWith("old")), false)
        ).toBeGreaterThan(
            estimateImportableUnits(menuWith("new"), cache(menuWith("old")), true) +
                4 * COST.commandMenuWait
        );
    });

    test.each([
        { slots: 41, changedSlots: 2, branches: 5 },
        { slots: 45, changedSlots: 8, branches: 2 },
    ])(
        "trusted $slots-slot menu prices changed item contents behind unchanged action names",
        ({ slots, changedSlots, branches }) => {
            const itemNbt = (marker: number): Tag => ({
                type: "compound",
                value: {
                    id: { type: "string", value: "minecraft:stone" },
                    tag: {
                        type: "compound",
                        value: { marker: { type: "int", value: marker } },
                    },
                },
            });
            const item = (name: string, marker: number): ImportableItem => ({
                type: "ITEM",
                name,
                nbt: itemNbt(marker),
            });
            const branch = (itemName: string): Action =>
                conditional({
                    conditions: [{ type: "REQUIRE_ITEM", itemName }],
                    ifActions: [{ type: "GIVE_ITEM", itemName }],
                    elseActions: [{ type: "REMOVE_ITEM", itemName }],
                });
            const menu: ImportableMenu = {
                type: "MENU",
                name: "synthetic stock",
                size: 6,
                slots: Array.from({ length: slots }, (_, slot) => ({
                    slot,
                    nbt: itemNbt(0),
                    actions: Array.from({ length: branches }, () =>
                        branch(slot < changedSlots ? "changed" : "stable")
                    ),
                })),
            };
            const oldProject: Importable[] = [
                menu,
                item("changed", 1),
                item("stable", 1),
            ];
            const oldDependencies = createItemDependencyIndex(
                oldProject,
                createProjectItemIndex(oldProject)
            );
            const cache = {
                importable: menu,
                lists: listHashes(menu),
                itemDependencies: oldDependencies.snapshotOf(menu),
            } as ImportableCacheEntry;
            const currentProject: Importable[] = [
                menu,
                item("changed", 2),
                item("stable", 1),
            ];
            const currentDependencies = createItemDependencyIndex(
                currentProject,
                createProjectItemIndex(currentProject)
            );

            // Each changed branch visits the parent, its three lists, and the
            // three item editors. All three items must be selected, spawned and
            // restored even though their reference names have not changed.
            const roundTrip = COST.menuClickWait + COST.goBackWait;
            const perBranch =
                7 * roundTrip +
                3 *
                    (COST.menuClickWait +
                        COST.itemSelect +
                        COST.itemInject +
                        COST.inventoryRestore);
            const perSlot =
                COST.commandMenuWait +
                2 * COST.menuClickWait +
                roundTrip +
                branches * perBranch;
            const expected =
                2 * (COST.commandMenuWait + COST.menuClickWait) +
                changedSlots * perSlot +
                COST.cacheWrite;
            expect(estimateImportableUnits(menu, cache, true)).toBeCloseTo(expected);

            // Updating the dependency snapshot makes the same large menu cheap
            // again; the other slots were never charged for their nested trees.
            expect(
                estimateImportableUnits(
                    menu,
                    {
                        ...cache,
                        itemDependencies: currentDependencies.snapshotOf(menu),
                    },
                    true
                )
            ).toBeCloseTo(COST.commandMenuWait + COST.menuClickWait + COST.cacheWrite);
        }
    );

    test("cached menu item placement includes spawning and scratch-slot restoration", () => {
        const menu: ImportableMenu = {
            type: "MENU",
            name: "new item",
            slots: [{ slot: 4, nbt: null as never }],
        };
        const cache: ImportableCacheEntry = {
            schemaVersion: 2,
            writtenAt: "2026-01-01T00:00:00.000Z",
            writer: "importer",
            hash: "0x0",
            importable: { ...menu, slots: [] },
            lists: {},
        };
        expect(estimateImportableUnits(menu, cache, true)).toBeCloseTo(
            2 * (COST.commandMenuWait + COST.menuClickWait) +
                COST.menuClickWait +
                COST.itemSelect +
                COST.itemInject +
                COST.inventoryRestore +
                COST.cacheWrite
        );
    });

    test("function estimate prices its editor open, its actions and the cache write", () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "f",
            actions: [message("hi")],
        };
        expect(estimateImportableCost(importable)).toBeCloseTo(
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
