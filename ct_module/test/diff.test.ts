import { describe, expect, test } from "vitest";
import type { Action, ActionPlaySound, Condition } from "htsw/types";

import {
    baselineActionListFromSlots,
    diffActionList,
} from "../src/housingSync/actions/diff";
import type { ActionListOperation } from "../src/housingSync/actions/diff/types";
import type { ObservedActionSlot } from "../src/housingSync/observedActions";
import type { ItemDiffContext } from "../src/housingSync/actions/diff/itemDiffContext";

import {
    changeVar,
    conditional,
    message,
    observedSlot as obs,
    playSound,
    random,
} from "./utils";

function ops(observed: ObservedActionSlot[], desired: Action[]): ActionListOperation[] {
    return diffActionList(baselineActionListFromSlots(observed), desired).operations;
}

function kindCounts(opsList: ActionListOperation[]): Record<string, number> {
    const out: Record<string, number> = { delete: 0, edit: 0, move: 0, add: 0 };
    for (const op of opsList) out[op.kind]++;
    return out;
}

function itemDiffContext(overrides: Partial<ItemDiffContext>): ItemDiffContext {
    return {
        hasActionList: () => false,
        actionsDiffer: () => false,
        conditionsDiffer: () => false,
        ...overrides,
    };
}

describe("diffActionList — empty / identity", () => {
    test("empty observed and empty desired => no ops", () => {
        expect(ops([], [])).toEqual([]);
    });

    test("identical lists produce no ops", () => {
        const a = message("hi");
        const b = message("bye");
        expect(ops([obs(0, a), obs(1, b)], [a, b])).toEqual([]);
    });

    test("identical actions in same order — no moves even with duplicates", () => {
        // Position-stable matching: when many actions are identical
        // (e.g. repeated message), prefer same-index pairing so we don't
        // emit gratuitous move ops.
        const m = message("repeated");
        const observed = [obs(0, m), obs(1, m), obs(2, m)];
        const desired = [m, m, m];
        expect(ops(observed, desired)).toEqual([]);
    });
});

describe("diffActionList — adds / deletes", () => {
    test("empty observed, one desired => single add", () => {
        const result = ops([], [message("hello")]);
        expect(kindCounts(result)).toMatchObject({ add: 1, edit: 0, move: 0, delete: 0 });
    });

    test("one observed, empty desired => single delete", () => {
        const result = ops([obs(0, message("hello"))], []);
        expect(kindCounts(result)).toMatchObject({ add: 0, edit: 0, move: 0, delete: 1 });
    });

    test("null observed slot becomes a delete", () => {
        // unparseable slots show up as observed with action: null. The
        // differ should clear them to free room for the desired list.
        const observed: ObservedActionSlot[] = [
            {
                index: 0,
                slotId: 0,
                slot: null as never,
                action: null,
                hydrated: false,
                truncatedFields: [],
            },
        ];
        const result = ops(observed, []);
        expect(kindCounts(result)).toMatchObject({ delete: 1 });
    });

    test("unhydrated observed action is deleted when desired is empty", () => {
        const live = obs(0, conditional({ ifActions: [message("live")] }));
        live.hydrated = false;

        const result = ops([live], []);

        expect(kindCounts(result)).toMatchObject({ delete: 1, edit: 0, add: 0 });
    });

    test("extra unhydrated conditionals are deleted from a shorter desired list", () => {
        const kept = message("kept");
        const extra = obs(1, conditional({ ifActions: [message("live")] }));
        extra.hydrated = false;

        const result = ops([obs(0, kept), extra], [kept]);

        expect(kindCounts(result)).toMatchObject({ delete: 1, edit: 0, add: 0 });
    });

    test("unhydrated conditional replaced by another type is deleted and added", () => {
        const live = obs(0, conditional({ ifActions: [message("live")] }));
        live.hydrated = false;

        const result = ops([live], [message("replacement")]);

        expect(kindCounts(result)).toMatchObject({ delete: 1, edit: 0, add: 1 });
    });
});

describe("diffActionList — edits", () => {
    test("invalidated item references force an edit when the item name is unchanged", () => {
        const observed = { type: "GIVE_ITEM", itemName: "key" } as Action;
        const desired = { type: "GIVE_ITEM", itemName: "key" } as Action;
        const itemDiff = itemDiffContext({
            actionsDiffer: (_observed, action) => action === desired,
        });

        const result = diffActionList(
            baselineActionListFromSlots([obs(0, observed)]),
            [desired],
            itemDiff
        ).operations;

        expect(kindCounts(result)).toMatchObject({ edit: 1, add: 0, delete: 0 });
    });

    test("observed item mismatches force an edit when source references are unchanged", () => {
        const observed = { type: "GIVE_ITEM", itemName: "key" } as Action;
        const desired = { type: "GIVE_ITEM", itemName: "key" } as Action;
        const itemDiff = itemDiffContext({ actionsDiffer: () => true });

        const result = diffActionList(
            baselineActionListFromSlots([obs(0, observed)]),
            [desired],
            itemDiff
        ).operations;

        expect(kindCounts(result)).toMatchObject({ edit: 1, add: 0, delete: 0 });
    });

    test("invalidated items in conditions keep the parent edit and condition diff", () => {
        const observedCondition = {
            type: "REQUIRE_ITEM",
            itemName: "key",
        } as Condition;
        const desiredCondition = {
            type: "REQUIRE_ITEM",
            itemName: "key",
        } as Condition;
        const observed = conditional({ conditions: [observedCondition] });
        const desired = conditional({ conditions: [desiredCondition] });
        const itemDiff = itemDiffContext({
            actionsDiffer: (_observed, action) => action === desired,
            conditionsDiffer: (_observed, condition) => condition === desiredCondition,
        });

        const result = diffActionList(
            baselineActionListFromSlots([obs(0, observed)]),
            [desired],
            itemDiff
        ).operations;
        const edit = result[0] as Extract<ActionListOperation, { kind: "edit" }>;

        expect(edit.kind).toBe("edit");
        expect(edit.childListDiffs).toHaveLength(1);
        expect(edit.childListDiffs[0].prop).toBe("conditions");
        expect(edit.childListDiffs[0].diff.operations[0].kind).toBe("edit");
    });

    test("invalidated items reach conditions inside nested action lists", () => {
        const observedCondition = {
            type: "REQUIRE_ITEM",
            itemName: "key",
        } as Condition;
        const desiredCondition = {
            type: "REQUIRE_ITEM",
            itemName: "key",
        } as Condition;
        const observedConditional = conditional({ conditions: [observedCondition] });
        const desiredConditional = conditional({ conditions: [desiredCondition] });
        const observed = random({ actions: [observedConditional] });
        const desired = random({ actions: [desiredConditional] });
        const itemDiff = itemDiffContext({
            actionsDiffer: (_observed, action) =>
                action === desired || action === desiredConditional,
            conditionsDiffer: (_observed, condition) => condition === desiredCondition,
        });

        const result = diffActionList(
            baselineActionListFromSlots([obs(0, observed)]),
            [desired],
            itemDiff
        ).operations;
        const rootEdit = result[0] as Extract<ActionListOperation, { kind: "edit" }>;
        const nestedEdit = rootEdit.childListDiffs[0].diff.operations[0] as Extract<
            ActionListOperation,
            { kind: "edit" }
        >;

        expect(nestedEdit.childListDiffs[0].prop).toBe("conditions");
        expect(nestedEdit.childListDiffs[0].diff.operations[0].kind).toBe("edit");
    });

    test("single field edit emits one edit op", () => {
        const observed = [obs(0, playSound({ volume: 0.5 }))];
        const desired = [playSound({ volume: 0.9 })];
        const result = ops(observed, desired);
        expect(kindCounts(result)).toMatchObject({ edit: 1, add: 0, delete: 0, move: 0 });
        const edit = result.find((op) => op.kind === "edit")!;
        expect(edit.kind).toBe("edit");
        const editOp = edit;
        expect(editOp.noteOnly).toBe(false);
        expect(editOp.childListDiffs).toEqual([]);
    });

    test("fields equal under canonicalisation produce no edit op", () => {
        // observed reads strings from lore; desired is parsed from source
        // as numbers/typed objects. The diff engine must treat them as
        // equal so the importer doesn't loop trying to apply no-op edits.
        const observed: ObservedActionSlot[] = [
            obs(
                0,
                playSound({
                    volume: "0.7" as unknown as number,
                    pitch: "1.0" as unknown as number,
                    location:
                        "Invokers Location" as unknown as ActionPlaySound["location"],
                })
            ),
        ];
        const desired = [
            playSound({
                volume: 0.7,
                pitch: 1.0,
                location: { type: "Invokers Location" },
            }),
        ];
        expect(ops(observed, desired)).toEqual([]);
    });

    test("note-only change is flagged with noteOnly=true", () => {
        const observed = [obs(0, message("hi", { note: "old" }))];
        const desired = [message("hi", { note: "new" })];
        const result = ops(observed, desired);
        const edit = result.find((op) => op.kind === "edit");
        expect(edit).toBeDefined();
        expect((edit as Extract<ActionListOperation, { kind: "edit" }>).noteOnly).toBe(
            true
        );
    });

    test("scalar change + note change emits non-noteOnly edit", () => {
        const observed = [obs(0, playSound({ volume: 0.5, note: "old" }))];
        const desired = [playSound({ volume: 0.9, note: "new" })];
        const result = ops(observed, desired);
        const edit = result.find((op) => op.kind === "edit");
        expect(edit).toBeDefined();
        expect(edit!.noteOnly).toBe(false);
        expect(edit!.noteDiffers).toBe(true);
    });

    test("conditional edit carries child action list diffs", () => {
        const observed = [
            obs(0, conditional({ ifActions: [message("old")], elseActions: [] })),
        ];
        const desired = [conditional({ ifActions: [message("new")], elseActions: [] })];

        const result = ops(observed, desired);
        const edit = result.find((op) => op.kind === "edit");

        expect(edit).toBeDefined();
        expect(edit!.childListDiffs).toHaveLength(1);
        expect(edit!.childListDiffs[0].prop).toBe("ifActions");
        expect(edit!.childListDiffs[0].diff.operations).toHaveLength(1);
        expect(edit!.childListDiffs[0].diff.operations[0].kind).toBe("edit");
    });

    test("conditional team var tail shift does not move the whole child list", () => {
        const actions = Array.from({ length: 25 }, (_, index) =>
            changeVar({
                holder: { type: "Team", team: "Blue" },
                key: `x${index + 1}`,
                value: String(index + 1),
            })
        );
        const observed = [obs(0, conditional({ ifActions: actions, elseActions: [] }))];
        const desired = [
            conditional({
                ifActions: [...actions.slice(23), ...actions.slice(0, 23)],
                elseActions: [],
            }),
        ];

        const result = ops(observed, desired);
        const edit = result.find((op) => op.kind === "edit");
        const childListMoves = edit?.childListDiffs[0].diff.operations.filter(
            (op) => op.kind === "move"
        );

        expect(kindCounts(result)).toMatchObject({ edit: 1, add: 0, delete: 0, move: 0 });
        expect(childListMoves).toHaveLength(2);
    });

    test("random edit carries child action list diffs", () => {
        const observed = [obs(0, random({ actions: [message("old")] }))];
        const desired = [random({ actions: [message("old"), playSound()] })];

        const result = ops(observed, desired);
        const edit = result.find((op) => op.kind === "edit");

        expect(edit).toBeDefined();
        expect(edit!.childListDiffs).toHaveLength(1);
        expect(edit!.childListDiffs[0].prop).toBe("actions");
        expect(
            edit!.childListDiffs[0].diff.operations.some((op) => op.kind === "add")
        ).toBe(true);
    });

    test("child list replacement cost keeps duplicate parent matches paired with the closest body", () => {
        const anchorOne = message("anchor-one");
        const anchorTwo = message("anchor-two");
        const observed = [
            obs(0, conditional({ ifActions: [message("replace-me")] })),
            obs(1, conditional({ ifActions: [message("keep-me")] })),
            obs(2, anchorOne),
            obs(3, anchorTwo),
        ];
        const desired = [
            anchorOne,
            anchorTwo,
            conditional({ ifActions: [message("keep-me"), message("added")] }),
            conditional({ ifActions: [playSound()] }),
        ];

        const result = ops(observed, desired);
        const edits = result.filter(
            (op): op is Extract<ActionListOperation, { kind: "edit" }> =>
                op.kind === "edit"
        );
        const keepEdit = edits.find((op) => op.entryId === 1);
        const replaceEdit = edits.find((op) => op.entryId === 0);

        expect(keepEdit?.desiredIndex).toBe(2);
        expect(
            keepEdit?.childListDiffs[0].diff.operations.some((op) => op.kind === "add")
        ).toBe(true);
        expect(replaceEdit?.desiredIndex).toBe(3);
    });

    test("completed trusted child action data does not emit fake edits", () => {
        const observed: ObservedActionSlot[] = [
            {
                ...obs(
                    0,
                    conditional({ ifActions: [message("trusted")], elseActions: [] })
                ),
                hydrated: true,
                childListSummaries: { ifActions: ["MESSAGE"] },
            },
        ];
        const desired = [
            conditional({ ifActions: [message("trusted")], elseActions: [] }),
        ];

        expect(ops(observed, desired)).toEqual([]);
    });
});

describe("diffActionList — moves", () => {
    test("two actions swapped emits move ops, no edits", () => {
        const a = message("aaa");
        const b = message("bbb");
        const result = ops([obs(0, a), obs(1, b)], [b, a]);
        const counts = kindCounts(result);
        expect(counts.edit).toBe(0);
        expect(counts.add).toBe(0);
        expect(counts.delete).toBe(0);
        expect(counts.move).toBeGreaterThan(0);
    });

    test("tail-to-front shift only emits moves for the shifted tail", () => {
        const actions = Array.from({ length: 25 }, (_, index) =>
            changeVar({ key: `x${index + 1}`, value: String(index + 1) })
        );
        const desired = [...actions.slice(23), ...actions.slice(0, 23)];
        const result = ops(
            actions.map((action, index) => obs(index, action)),
            desired
        );
        const moves = result.filter((op) => op.kind === "move");

        expect(kindCounts(result)).toMatchObject({ edit: 0, add: 0, delete: 0 });
        expect(moves).toHaveLength(2);
        expect(moves.map((op) => [op.fromIndex, op.toIndex])).toEqual([
            [23, 0],
            [24, 1],
        ]);
    });
});

describe("diffActionList — type mismatches", () => {
    test("different action type at same index becomes delete + add", () => {
        const result = ops([obs(0, message("hi"))], [playSound()]);
        const counts = kindCounts(result);
        expect(counts.delete).toBe(1);
        expect(counts.add).toBe(1);
    });
});

describe("diffActionList — combined scenarios", () => {
    test("mix of delete + edit + move + add are all emitted", () => {
        // a stays at index 0, b moves from 1 to 2, c changes content (edit),
        // a PLAY_SOUND gets deleted (no same-type partner among desired),
        // and d is added. Mixing types is required: same-type matching is
        // greedy, so a stray MESSAGE would otherwise be paired with d as
        // an edit instead of becoming a delete.
        const a = message("a");
        const b = message("b");
        const cOld = message("c-old");
        const cNew = message("c-new");
        const d = message("d");
        const sound = playSound();
        const observed = [obs(0, a), obs(1, b), obs(2, cOld), obs(3, sound)];
        const desired = [a, cNew, b, d];

        const result = ops(observed, desired);
        const counts = kindCounts(result);
        expect(counts.delete).toBe(1);
        expect(counts.edit).toBe(1);
        expect(counts.move).toBeGreaterThanOrEqual(1);
        expect(counts.add).toBe(1);
    });
});
