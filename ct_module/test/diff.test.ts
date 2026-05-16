import { describe, expect, test } from "vitest";
import type { Action, ActionPlaySound } from "htsw/types";

import { diffActionList } from "../src/importer/actions/diff";
import type {
    ActionListOperation,
    ObservedActionSlot,
} from "../src/importer/types";

import { conditional, message, observedSlot as obs, playSound, random } from "./utils";

function ops(observed: ObservedActionSlot[], desired: Action[]): ActionListOperation[] {
    return diffActionList(observed, desired).operations;
}

function kindCounts(opsList: ActionListOperation[]): Record<string, number> {
    const out: Record<string, number> = { delete: 0, edit: 0, move: 0, add: 0 };
    for (const op of opsList) out[op.kind]++;
    return out;
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
            { index: 0, slotId: 0, slot: null as never, action: null },
        ];
        const result = ops(observed, []);
        expect(kindCounts(result)).toMatchObject({ delete: 1 });
    });
});

describe("diffActionList — edits", () => {
    test("single field edit emits one edit op", () => {
        const observed = [obs(0, playSound({ volume: 0.5 }))];
        const desired = [playSound({ volume: 0.9 })];
        const result = ops(observed, desired);
        expect(kindCounts(result)).toMatchObject({ edit: 1, add: 0, delete: 0, move: 0 });
        const edit = result.find((op) => op.kind === "edit")!;
        expect(edit.kind).toBe("edit");
        const editOp = edit as Extract<ActionListOperation, { kind: "edit" }>;
        expect(editOp.noteOnly).toBe(false);
        expect(editOp.nestedDiffs).toEqual([]);
    });

    test("fields equal under canonicalisation produce no edit op", () => {
        // observed reads strings from lore; desired is parsed from source
        // as numbers/typed objects. The diff engine must treat them as
        // equal so the importer doesn't loop trying to apply no-op edits.
        const observed = [
            obs(
                0,
                playSound({
                    volume: "0.7" as unknown as number,
                    pitch: "1.0" as unknown as number,
                    location: "Invokers Location" as unknown as ActionPlaySound["location"],
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
        expect((edit as Extract<ActionListOperation, { kind: "edit" }>).noteOnly).toBe(true);
    });

    test("scalar change + note change emits non-noteOnly edit", () => {
        const observed = [obs(0, playSound({ volume: 0.5, note: "old" }))];
        const desired = [playSound({ volume: 0.9, note: "new" })];
        const result = ops(observed, desired);
        const edit = result.find((op) => op.kind === "edit") as
            | Extract<ActionListOperation, { kind: "edit" }>
            | undefined;
        expect(edit).toBeDefined();
        expect(edit!.noteOnly).toBe(false);
        expect(edit!.noteDiffers).toBe(true);
    });

    test("conditional edit carries nested action list diffs", () => {
        const observed = [
            obs(0, conditional({ ifActions: [message("old")], elseActions: [] })),
        ];
        const desired = [
            conditional({ ifActions: [message("new")], elseActions: [] }),
        ];

        const result = ops(observed, desired);
        const edit = result.find((op) => op.kind === "edit") as
            | Extract<ActionListOperation, { kind: "edit" }>
            | undefined;

        expect(edit).toBeDefined();
        expect(edit!.nestedDiffs).toHaveLength(1);
        expect(edit!.nestedDiffs[0].prop).toBe("ifActions");
        expect(edit!.nestedDiffs[0].diff.operations).toHaveLength(1);
        expect(edit!.nestedDiffs[0].diff.operations[0].kind).toBe("edit");
    });

    test("random edit carries nested action list diffs", () => {
        const observed = [obs(0, random({ actions: [message("old")] }))];
        const desired = [random({ actions: [message("old"), playSound()] })];

        const result = ops(observed, desired);
        const edit = result.find((op) => op.kind === "edit") as
            | Extract<ActionListOperation, { kind: "edit" }>
            | undefined;

        expect(edit).toBeDefined();
        expect(edit!.nestedDiffs).toHaveLength(1);
        expect(edit!.nestedDiffs[0].prop).toBe("actions");
        expect(edit!.nestedDiffs[0].diff.operations.some((op) => op.kind === "add")).toBe(true);
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
