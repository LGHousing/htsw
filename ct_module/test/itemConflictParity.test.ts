import { describe, expect, it } from "vitest";
import type { Action } from "htsw/types";

import { actionListConflictVerdict } from "../src/housingSync/actions/conflicts";
import { actionListContentHashFromActions, actionListScanHashFromActions } from "../src/housingSync/actions/scanHash";
import type { ItemFieldContent } from "../src/housingSync/items/fieldContent";
import { observedSlot } from "./utils";

function itemContent(key: string): ItemFieldContent {
    return () => key;
}

function verdicts(
    live: Action,
    source: Action,
    liveItems: ItemFieldContent,
    sourceItems: ItemFieldContent
) {
    const baseline = [source];
    const lock = {
        contentHash: actionListContentHashFromActions(baseline, sourceItems),
        scanHash: actionListScanHashFromActions(baseline),
    };
    return {
        diff: actionListConflictVerdict(
            { actions: [live] },
            lock,
            [source],
            "content",
            liveItems,
            sourceItems
        ),
        importGate: actionListConflictVerdict(
            { slots: [observedSlot(0, live)] },
            lock,
            [source],
            "content",
            liveItems,
            sourceItems
        ),
    };
}

describe("item conflict parity", () => {
    it("treats a direct .snbt reference and a live capture slug as the same item", () => {
        const source = {
            type: "GIVE_ITEM",
            itemName: "mvp_cookies.snbt",
        } as Action;
        const live = {
            type: "GIVE_ITEM",
            itemName: "mvp_002b_cookies__0028right_click_0029",
        } as Action;

        expect(
            verdicts(
                live,
                source,
                itemContent("cookie"),
                itemContent("cookie")
            )
        ).toEqual({ diff: "unchanged", importGate: "unchanged" });
    });

    it("reports a real canonical item change in both paths", () => {
        const source = {
            type: "GIVE_ITEM",
            itemName: "ingredient_bag.snbt",
        } as Action;
        const live = {
            type: "GIVE_ITEM",
            itemName: "ingredient_bag",
        } as Action;

        expect(
            verdicts(
                live,
                source,
                itemContent("apple"),
                itemContent("cookie")
            )
        ).toEqual({ diff: "conflict", importGate: "conflict" });
    });
});
