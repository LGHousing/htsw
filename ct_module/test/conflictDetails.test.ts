import { describe, expect, it } from "vitest";

import { actionListConflictDetails } from "../src/housingSync/actions/conflictDetails";
import { conditional, message, playSound } from "./utils";
import type { Action } from "htsw/types";

describe("action-list conflict details", () => {
    it("compares item fields by canonical content", () => {
        const source = {
            type: "GIVE_ITEM",
            itemName: "ingredient_bag.snbt",
        } as Action;
        const live = {
            type: "GIVE_ITEM",
            itemName: "ingredient_bag",
        } as Action;
        const cookie = {
            type: "compound" as const,
            value: { id: { type: "string" as const, value: "minecraft:cookie" } },
        };
        const apple = {
            type: "compound" as const,
            value: { id: { type: "string" as const, value: "minecraft:apple" } },
        };

        expect(
            actionListConflictDetails(
                [live],
                [source],
                () => ({ key: "cookie", tag: cookie }),
                () => ({ key: "cookie", tag: cookie })
            )
        ).toEqual({ differences: [], moreCount: 0 });

        expect(
            actionListConflictDetails(
                [live],
                [source],
                () => ({ key: "apple", tag: apple }),
                () => ({ key: "cookie", tag: cookie })
            ).differences
        ).toEqual([
            {
                path: "action 1 (give item) · itemName",
                live: '{\n    id: "minecraft:apple"\n}',
                source: '{\n    id: "minecraft:cookie"\n}',
            },
        ]);
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
