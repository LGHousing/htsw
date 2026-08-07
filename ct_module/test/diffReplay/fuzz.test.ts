/// <reference types="node" />

import { describe, expect, test } from "vitest";
import type { Action } from "htsw/types";

import {
    diffActionList,
    baselineActionListFromActions,
} from "../../src/housingSync/actions/diff";
import { changeVar, conditional, message, playSound } from "../utils";
import { actionListsEqual, applyPlan } from "./oracle";
import { scoreDiff } from "./scorer";

const seeds = [0x1a2b3c4d, 0x6d2b79f5, 0xc0ffee];
const iterations = Number(process.env.HTSW_DIFF_FUZZ_ITERATIONS ?? 80);

function generator(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
    };
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function baseActions(): Action[] {
    return [
        message("alpha"),
        changeVar({ key: "speed", value: "1" }),
        playSound({ pitch: 0.75 }),
        { type: "PAUSE", ticks: 2 },
        message("omega"),
    ];
}

function randomIndex(random: () => number, length: number): number {
    return Math.floor(random() * length);
}

function mutate(base: Action[], random: () => number, kind: number): Action[] {
    const desired = clone(base);
    if (kind === 0) {
        const start = randomIndex(random, desired.length - 1);
        const count = 2 + randomIndex(random, desired.length - start - 1);
        const block = desired.splice(start, count).reverse();
        desired.splice(start, 0, ...block);
    } else if (kind === 1) {
        desired.splice(randomIndex(random, desired.length), 1 + randomIndex(random, 2));
    } else if (kind === 2) {
        const source = clone(desired[randomIndex(random, desired.length)]) as Record<
            string,
            unknown
        >;
        source.note = `copy-${Math.floor(random() * 10000)}`;
        desired.splice(randomIndex(random, desired.length + 1), 0, source as Action);
    } else if (kind === 3) {
        const index = randomIndex(random, desired.length);
        desired[index] =
            desired[index].type === "MESSAGE" ? playSound() : message(`retyped-${index}`);
    } else if (kind === 4) {
        const index = randomIndex(random, desired.length);
        desired[index] = {
            ...desired[index],
            note: `note-${Math.floor(random() * 10000)}`,
        };
    } else {
        desired[0] = message(`alpha-${Math.floor(random() * 10000)}`);
    }
    return desired;
}

function checkPlan(current: Action[], desired: Action[]): ReturnType<typeof scoreDiff> {
    const baseline = baselineActionListFromActions(current);
    const diff = diffActionList(baseline, desired);
    expect(actionListsEqual(applyPlan(baseline, diff.operations), desired)).toBe(true);
    return scoreDiff(diff);
}

describe("diff perturbation fuzzing", () => {
    test("seeded structural and scalar perturbations replay correctly without churn", () => {
        for (const seed of seeds) {
            const random = generator(seed);
            for (let iteration = 0; iteration < iterations; iteration++) {
                const current = baseActions();
                const score = checkPlan(current, mutate(current, random, iteration % 6));
                expect(score.churn).toBe(0);
            }
        }
    });

    test("canonical cosmetic perturbations produce no operations", () => {
        const pairs: Array<[Action, Action]> = [
            [
                changeVar({ value: "accelerate &8| &7Left-click" }),
                changeVar({ value: "accelerate  &8|  &7Left-click" }),
            ],
            [playSound({ pitch: 0.062 }), playSound({ pitch: 0.0625 })],
            [playSound(), playSound({ location: "Not Set" as never })],
            [
                conditional({
                    conditions: [
                        {
                            type: "COMPARE_VAR",
                            holder: { type: "Player" },
                            var: "x",
                            op: "Equal",
                            amount: "1",
                            fallback: '"Not Set"',
                        },
                    ],
                }),
                conditional({
                    conditions: [
                        {
                            type: "COMPARE_VAR",
                            holder: { type: "Player" },
                            var: "x",
                            op: "Equal",
                            amount: "1",
                        },
                    ],
                }),
            ],
        ];
        for (const [observed, desired] of pairs) {
            const diff = diffActionList(baselineActionListFromActions([observed]), [
                desired,
            ]);
            expect(diff.operations).toEqual([]);
            expect(
                actionListsEqual(
                    applyPlan(baselineActionListFromActions([observed]), diff.operations),
                    [desired]
                )
            ).toBe(true);
        }
    });

    test("a pure shuffle across action types uses only moves", () => {
        const current = baseActions().slice(0, 4);
        const desired = [current[2], current[0], current[3], current[1]];
        const diff = diffActionList(baselineActionListFromActions(current), desired);
        expect(diff.operations.length).toBeGreaterThan(0);
        expect(diff.operations.every((operation) => operation.kind === "move")).toBe(
            true
        );
        expect(scoreDiff(diff).churn).toBe(0);
        expect(
            actionListsEqual(
                applyPlan(baselineActionListFromActions(current), diff.operations),
                desired
            )
        ).toBe(true);
    });
});
