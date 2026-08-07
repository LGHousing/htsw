import { describe, expect, it } from "vitest";

import { actionListConflictDetails } from "../src/housingSync/actions/conflictDetails";
import { conditional, message, playSound } from "./utils";
import type { Action, Condition } from "htsw/types";

describe("action-list conflict details", () => {
    it("ignores item operand aliases and reports canonical item changes", () => {
        const source = {
            type: "GIVE_ITEM",
            itemName: "ingredient_bag.snbt",
        } as Action;
        const live = {
            type: "GIVE_ITEM",
            itemName: "ingredient_bag",
        } as Action;
        expect(
            actionListConflictDetails(
                [live],
                [source],
                () => "cookie",
                () => "cookie"
            )
        ).toEqual({ differences: [], moreCount: 0 });

        expect(
            actionListConflictDetails(
                [live],
                [source],
                () => "apple",
                () => "cookie"
            )
        ).toMatchObject({
            differences: [
                {
                    path: "action 1 (give item) · itemName",
                    live: "apple",
                    source: "cookie",
                },
            ],
            moreCount: 0,
        });
    });

    it("keeps item sections within the general difference cap", () => {
        const live: Action[] = Array.from(
            { length: 6 },
            (_, index): Action =>
                ({
                    type: "GIVE_ITEM",
                    itemName: `live-${index}`,
                })
        );
        const source: Action[] = Array.from(
            { length: 6 },
            (_, index): Action =>
                ({
                    type: "GIVE_ITEM",
                    itemName: `source-${index}`,
                })
        );
        const result = actionListConflictDetails(
            live,
            source,
            (owner) => `live-${live.indexOf(owner as Action)}`,
            (owner) => `source-${source.indexOf(owner as Action)}`
        );

        expect(result.differences).toHaveLength(5);
        expect(result.moreCount).toBe(1);
    });

    it("reports scalar changes", () => {
        expect(actionListConflictDetails([message("live")], [message("source")])).toEqual(
            {
                differences: [
                    {
                        path: "action 1 (message) · message",
                        live: '"live"',
                        source: '"source"',
                    },
                ],
                moreCount: 0,
            }
        );
    });

    it("reports note changes", () => {
        const result = actionListConflictDetails(
            [message("same", { note: "live note" })],
            [message("same", { note: "source note" })]
        );

        expect(result.differences).toEqual([
            {
                path: "action 1 (message) · note",
                live: '"live note"',
                source: '"source note"',
            },
        ]);
    });

    it("reports added and removed actions", () => {
        expect(actionListConflictDetails([message("live")], []).differences).toEqual([
            {
                path: "action 1 (message)",
                live: "<message>",
                source: "<unset>",
            },
        ]);
        expect(actionListConflictDetails([], [playSound()]).differences).toEqual([
            {
                path: "action 1 (play sound)",
                live: "<unset>",
                source: "<play_sound>",
            },
        ]);
    });

    it("reports nested child-list changes", () => {
        const result = actionListConflictDetails(
            [conditional({ ifActions: [message("live")] })],
            [conditional({ ifActions: [message("source")] })]
        );

        expect(result.differences).toEqual([
            {
                path: "action 1 (conditional) · ifActions · action 1 (message) · message",
                live: '"live"',
                source: '"source"',
            },
        ]);
    });

    it("reports no conflict differences for rotated condition lists", () => {
        const first = { type: "IS_SNEAKING" } as Condition;
        const second = { type: "IS_SNEAKING", inverted: true } as Condition;

        expect(
            actionListConflictDetails(
                [conditional({ conditions: [first, second] })],
                [conditional({ conditions: [second, first] })]
            )
        ).toEqual({ differences: [], moreCount: 0 });
    });

    it("pairs genuinely changed conditions by type and cost", () => {
        const live = [
            { type: "IS_SNEAKING" },
            { type: "IS_SNEAKING", inverted: true },
        ] as Condition[];
        const source = [
            { type: "IS_SNEAKING", inverted: true },
            { type: "IS_SNEAKING", note: "changed" },
        ] as Condition[];

        expect(
            actionListConflictDetails(
                [conditional({ conditions: live })],
                [conditional({ conditions: source })]
            ).differences
        ).toEqual([
            {
                path: "action 1 (conditional) · conditions · condition 2 (is sneaking) · note",
                live: "<unset>",
                source: '"changed"',
            },
        ]);
    });

    it("still reports action-order changes", () => {
        expect(
            actionListConflictDetails(
                [message("same"), playSound()],
                [playSound(), message("same")]
            ).differences
        ).not.toEqual([]);
    });

    it("summarizes nested child-list length changes", () => {
        const result = actionListConflictDetails(
            [conditional({ ifActions: [message("live")] })],
            [conditional()]
        );

        expect(result.differences).toEqual([
            {
                path: "action 1 (conditional) · ifActions",
                live: "<1 child>",
                source: "<0 children>",
            },
        ]);
    });

    it("caps details and counts remaining differences", () => {
        const live = Array.from({ length: 7 }, (_, i) => message(`live ${i}`));
        const source = Array.from({ length: 7 }, (_, i) => message(`source ${i}`));
        const result = actionListConflictDetails(live, source);

        expect(result.differences).toHaveLength(5);
        expect(result.moreCount).toBe(2);
    });

    it("compacts long values", () => {
        const result = actionListConflictDetails(
            [message("l".repeat(80))],
            [message("s".repeat(80))]
        );

        expect(result.differences[0]).toEqual({
            path: "action 1 (message) · message",
            live: `"${"l".repeat(46)}…`,
            source: `"${"s".repeat(46)}…`,
        });
    });
});
