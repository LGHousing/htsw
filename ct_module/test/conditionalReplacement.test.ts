import { describe, expect, test, vi } from "vitest";
import type { Action } from "htsw/types";
import { conditional, message } from "./utils";
import { actionsEqual } from "../src/housingSync/actions/comparison";
import { createKnownActionListPlan } from "../src/housingSync/actions/plan";
import { scanActionList } from "../src/housingSync/actions/readList";
import type { ObservedActionSlot } from "../src/housingSync/observedActions";
import {
    applyActionListPlan,
    actionListApplyResultFromError,
} from "../src/housingSync/actions/apply";
import { CONDITIONAL_BUILD_NOTE } from "../src/housingSync/actions/conditionalSafety";
import type { ConditionalBlockIo } from "../src/housingSync/actions/apply/conditional";
import type { ActionSyncContext } from "../src/housingSync/actions/syncContext";

type Conditional = Extract<Action, { type: "CONDITIONAL" }>;
const active = vi.hoisted(() => ({
    house: undefined as unknown as House,
    scan: [] as ObservedActionSlot[],
}));
vi.mock("../src/housingSync/actions/apply/conditional", async (original) => ({
    ...(await original<typeof import("../src/housingSync/actions/apply/conditional")>()),
    conditionalBlockIo: () => active.house.io,
}));
vi.mock("../src/housingSync/menus/paginatedList", () => ({
    readPaginatedList: async () => active.scan,
    goToPaginatedListPage: async () => undefined,
    getPaginatedListSlotAtIndex: async (_ctx: unknown, index: number) => ({
        index,
        click: () => {
            active.house.openIndex = index;
        },
    }),
}));
vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: async () => undefined,
}));
vi.mock("../src/housingSync/menus/menuUtils", () => ({
    clickGoBack: async () => undefined,
    setListItemNote: async (
        _ctx: unknown,
        slot: { index: number },
        note: string | undefined
    ) => {
        active.house.actions[slot.index].note = note;
        active.house.tick();
    },
}));
vi.mock("../src/housingSync/actions/apply/actionOps", async (original) => ({
    ...(await original<typeof import("../src/housingSync/actions/apply/actionOps")>()),
    deleteObservedAction: (_ctx: unknown, index: number, length: number) =>
        active.house.io.remove(index, length),
    moveActionToIndex: (_ctx: unknown, from: number, to: number, length: number) =>
        active.house.io.move(from, to, length),
}));
vi.mock("../src/housingSync/actions/io", () => ({
    getActionIo: () => ({ write: true }),
    writeOpenAction: async (_ctx: unknown, desired: Conditional) => {
        const house = active.house;
        const current = house.actions[house.openIndex] as Conditional;
        // Deliberately emulate the original dangerous guard-first writer.
        // Only empty blocks, or body-only edits, may reach this writer now.
        if (
            !actionsEqual(
                { ...current, ifActions: [], elseActions: [], note: undefined },
                { ...desired, ifActions: [], elseActions: [], note: undefined }
            )
        ) {
            current.conditions = [];
            house.tick();
            for (const guard of desired.conditions) {
                current.conditions.push(guard);
                house.tick();
            }
            current.matchAny = desired.matchAny;
            house.tick();
        }
        for (const prop of ["ifActions", "elseActions"] as const) {
            current[prop] = [];
            house.tick();
            for (const action of desired[prop]) {
                current[prop].push(action);
                house.tick();
            }
        }
    },
}));

const old: Conditional = conditional({
    conditions: [{ type: "IS_SNEAKING" }],
    ifActions: [message("WIP!"), { type: "SEND_TO_LOBBY" }],
});
const desired: Conditional = conditional({
    matchAny: true,
    conditions: [{ type: "IS_FLYING" }, { type: "IS_DOING_PARKOUR" }],
    ifActions: [message("WIP!"), { type: "SEND_TO_LOBBY" }],
    elseActions: [message("new else")],
    note: "desired note",
});
const source = [message("before"), desired, message("after")];
const initial = [message("before"), old, message("after")];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const predicate = (action: Conditional): string =>
    JSON.stringify([
        action.matchAny,
        action.conditions.map(({ note: _note, ...guard }) => guard),
    ]);
const sync = {
    canonicalizeItemName: (name: string) => name,
    resolveItem: () => {
        throw new Error("No items in this regression");
    },
    trust: { trustMode: false },
    itemRead: { mode: "sync" },
} as unknown as ActionSyncContext;
const ctx = {
    checkCancelled: () => undefined,
    finishBeforeCancelling: (run: () => Promise<unknown>) => run(),
} as never;

class House {
    actions: Action[] = clone(initial);
    openIndex = 0;
    steps = 0;
    interruptAt = Infinity;
    capacity = 25;
    failVerification = false;
    events: string[] = [];

    tick(): void {
        this.assertSafe();
        if (++this.steps === this.interruptAt) throw new Error("connection lost");
    }

    assertSafe(): void {
        const populated = this.actions.filter(
            (action): action is Conditional =>
                action.type === "CONDITIONAL" &&
                action.ifActions.length + action.elseActions.length > 0
        );
        expect(populated.length).toBeLessThanOrEqual(1);
        for (const action of populated) {
            const body = [...action.ifActions, ...action.elseActions];
            expect([predicate(old), predicate(desired)]).toContain(predicate(action));
            if (
                body.some(
                    (entry) => entry.type === "MESSAGE" && entry.message === "new else"
                )
            ) {
                expect(predicate(action)).toBe(predicate(desired));
            }
        }
    }

    io: ConditionalBlockIo = {
        canStage: async () =>
            this.actions.filter((action) => action.type === "CONDITIONAL").length <
            this.capacity,
        appendEmpty: async (stage) => {
            const empty: Conditional = conditional();
            this.actions.push(empty);
            this.events.push("create");
            this.tick();
            for (const guard of stage.conditions) {
                empty.conditions.push(clone(guard));
                this.tick();
            }
            empty.matchAny = stage.matchAny;
            this.tick();
            empty.note = stage.note;
            this.tick();
        },
        verify: async (index, length, expected) => {
            expect(this.actions.length).toBe(length);
            // Comparison caches assume immutable reads, as the real reader
            // returns. This model keeps mutable server objects between clicks.
            expect(actionsEqual(clone(this.actions[index]), clone(expected))).toBe(true);
            this.events.push("verify");
            if (this.failVerification) throw new Error("read-back mismatch");
        },
        remove: async (index, length) => {
            expect(this.actions.length).toBe(length);
            this.actions.splice(index, 1);
            this.events.push("remove");
            this.tick();
        },
        move: async (from, to, length) => {
            expect(this.actions.length).toBe(length);
            while (from > to) {
                [this.actions[from], this.actions[from - 1]] = [
                    this.actions[from - 1],
                    this.actions[from],
                ];
                from--;
                this.tick();
            }
            while (from < to) {
                [this.actions[from], this.actions[from + 1]] = [
                    this.actions[from + 1],
                    this.actions[from],
                ];
                from++;
                this.tick();
            }
        },
        populate: async (index, length, _stage, completed) => {
            expect(this.actions.length).toBe(length);
            const current = this.actions[index] as Conditional;
            expect(predicate(current)).toBe(predicate(completed));
            this.events.push("populate");
            for (const prop of ["ifActions", "elseActions"] as const) {
                for (const action of completed[prop]) {
                    current[prop].push(clone(action));
                    this.tick();
                }
            }
        },
        finishNote: async (index, _length, note) => {
            this.actions[index].note = note;
            this.tick();
        },
    };
}

async function importHouse(house: House, target = source): Promise<void> {
    active.house = house;
    const plan = createKnownActionListPlan(clone(target), clone(house.actions), { sync });
    await applyActionListPlan(ctx, plan, { sync });
}

describe("conditional replacement during automatic execution", () => {
    test.each([25, 1])(
        "every mutation survives interruption and a fresh import at capacity %i",
        async (capacity) => {
            const complete = new House();
            complete.capacity = capacity;
            await importHouse(complete);
            expect(complete.actions).toEqual(source);
            expect(complete.events.indexOf("remove")).toBeLessThan(
                complete.events.indexOf("populate")
            );
            if (capacity === 25)
                expect(complete.events.indexOf("verify")).toBeLessThan(
                    complete.events.indexOf("remove")
                );
            else expect(complete.events[0]).toBe("remove");

            for (let cut = 1; cut <= complete.steps; cut++) {
                const interrupted = new House();
                interrupted.capacity = capacity;
                interrupted.interruptAt = cut;
                let thrown: unknown;
                try {
                    await importHouse(interrupted);
                } catch (error) {
                    thrown = error;
                }
                expect(thrown).toBeDefined();
                expect(actionListApplyResultFromError(thrown)).toBeNull();
                // The server keeps repeating this durable state after disconnect.
                for (let repeat = 0; repeat < 20; repeat++) interrupted.assertSafe();
                interrupted.interruptAt = Infinity;
                await importHouse(interrupted);
                expect(interrupted.actions).toEqual(source);
            }
        }
    );

    test("a failed predicate read-back preserves the old body and never populates the stage", async () => {
        const house = new House();
        house.failVerification = true;
        await expect(importHouse(house)).rejects.toThrow("read-back mismatch");
        expect(house.actions[1]).toEqual(old);
        expect(house.events).not.toContain("populate");
        expect(house.events).not.toContain("remove");
        house.assertSafe();
    });

    test("fresh conditional additions verify and position empty blocks before effects", async () => {
        const house = new House();
        house.actions = [message("before"), message("after")];
        await importHouse(house);
        expect(house.actions).toEqual(source);
        expect(house.events).toEqual([
            "create",
            "verify",
            "verify",
            "populate",
            "verify",
        ]);
    });

    test("the planner replaces guard/mode changes, including empty partial builds, but allows note-only changes", () => {
        for (const current of [
            old,
            { ...old, ifActions: [], elseActions: [], note: CONDITIONAL_BUILD_NOTE },
        ]) {
            const plan = createKnownActionListPlan([desired], [current], { sync });
            expect(
                plan.diff.operations.some(
                    (op) => op.kind === "edit" && op.replaceConditional
                )
            ).toBe(true);
        }
        const noted = {
            ...old,
            conditions: [{ ...old.conditions[0], note: "annotation" }],
        };
        const plan = createKnownActionListPlan([noted], [old], { sync });
        expect(
            plan.diff.operations.some((op) => op.kind === "edit" && op.replaceConditional)
        ).toBe(false);
    });

    test("a durable build marker prevents reuse of cached conditions with the same shallow shape", async () => {
        const entry: ObservedActionSlot = {
            index: 0,
            action: {
                type: "CONDITIONAL",
                matchAny: true,
                elseActions: [],
                ifActions: [],
                note: CONDITIONAL_BUILD_NOTE,
            },
            hydrated: false,
            truncatedFields: [],
            childListSummaries: {
                conditions: ["IS_FLYING", "IS_DOING_PARKOUR"],
                ifActions: [],
                elseActions: [],
            },
            childListsToRead: new Set(["conditions"]),
        };
        active.scan = [entry];
        const result = await scanActionList(
            ctx,
            {
                kind: "sync",
                desired: [desired],
                trust: {
                    basePath: "actions",
                    trustedChildListPaths: new Set(["actions[0].conditions"]),
                    trustedChildLists: new Map([
                        [
                            "actions[0].conditions",
                            {
                                kind: "conditions",
                                conditions: desired.conditions.map((guard) => ({
                                    ...guard,
                                    inverted: true,
                                })),
                            },
                        ],
                    ]),
                },
            },
            { itemReadMode: "sync", canonicalizeItemName: (name) => name }
        );
        expect(result.plan.get(entry)?.childListsToRead.has("conditions")).toBe(true);
        expect(
            entry.action?.type === "CONDITIONAL" && entry.action.conditions
        ).toBeUndefined();
    });
});
