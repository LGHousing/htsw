// Run a real capture with: $env:HTSW_DIFF_CAPTURE='C:\path\to\import-diff-capture.jsonl'; npm test -- test/diffReplay/diffReplay.test.ts
/// <reference types="node" />

import { describe, expect, test } from "vitest";
import type { Action } from "htsw/types";

import { actionCreationCost } from "../../src/housingSync/actions/diff";
import type { CurrentActionListEntry } from "../../src/housingSync/actions/diff/types";
import { loadDiffCapture, parseDiffCapture, type DiffInputCapture } from "./loader";
import { scoreOptimality } from "./optimal";
import { replayDiffCaptures } from "./runner";

const message = (text: string): Action => ({ type: "MESSAGE", message: text });

function capture(
    label: string,
    current: CurrentActionListEntry[],
    desired: Action[]
): DiffInputCapture {
    return { kind: "diffInput", tMs: 0, label, current, desired, hadItemDiff: false };
}

describe("diff capture replay", () => {
    test("prices container creation above scalar-only creation", () => {
        const scalar = message("hello");
        const container: Action = {
            type: "CONDITIONAL",
            matchAny: false,
            conditions: [{ type: "IS_SNEAKING" }],
            ifActions: [message("one"), message("two")],
            elseActions: [],
        };

        expect(actionCreationCost(scalar)).toBe(4);
        expect(actionCreationCost(container)).toBe(12);
        expect(actionCreationCost(container)).toBeGreaterThan(
            actionCreationCost(scalar)
        );
    });

    test("keeps a mostly-equal action as an edit in the optimal reference", () => {
        const current = {
            type: "PLAY_SOUND",
            sound: "random.orb",
            volume: 0.7,
            pitch: 1,
        } as Action;
        const desired = { ...current, volume: 0.8 } as Action;

        const score = scoreOptimality(
            [{ entryId: 0, index: 0, action: current, editable: true }],
            [desired]
        );

        expect(score.greedyCost).toBe(4);
        expect(score.optimalCost).toBe(4);
        expect(score.excess).toBe(0);
    });

    test("replays operation kinds and scores identical delete/add churn", () => {
        const repeated = message("same");
        const cleanBefore = message("before");
        const cleanAfter = message("after");
        const jsonl = [
            capture(
                "churn",
                [{ entryId: 0, index: 0, action: repeated, editable: false }],
                [repeated]
            ),
            capture(
                "edit",
                [{ entryId: 0, index: 0, action: cleanBefore, editable: true }],
                [cleanAfter]
            ),
        ]
            .map((record) => JSON.stringify(record))
            .join("\n");

        const report = replayDiffCaptures(parseDiffCapture(jsonl));

        expect(
            report.records[0].diff.operations.map((operation) => operation.kind)
        ).toEqual(["delete", "add"]);
        expect(report.records[0].score.churn).toBe(1);
        expect(
            report.records[1].diff.operations.map((operation) => operation.kind)
        ).toEqual(["edit"]);
        expect(report.records[1].score.churn).toBe(0);
        expect(report.aggregate).toEqual({
            operations: { add: 1, delete: 1, edit: 1, move: 0 },
            churn: 1,
        });
        expect(report.oraclePasses).toBe(2);
    });
});

const capturePath = process.env.HTSW_DIFF_CAPTURE;
test.skipIf(capturePath === undefined)("replays a real diff capture", () => {
    const report = replayDiffCaptures(loadDiffCapture(capturePath!));
    process.stdout.write(
        `${JSON.stringify({ aggregate: report.aggregate, oraclePasses: report.oraclePasses, optimality: report.optimality }, null, 2)}\n`
    );
    expect(report.records.length).toBeGreaterThan(0);
    expect(report.oraclePasses).toBe(report.records.length);
});
