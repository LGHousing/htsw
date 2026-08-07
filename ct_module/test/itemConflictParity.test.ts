import { describe, expect, it } from "vitest";
import type { Action, ImportableFunction } from "htsw/types";

import { actionListConflictVerdict } from "../src/housingSync/actions/conflicts";
import { actionListContentHashFromActions, actionListScanHashFromActions } from "../src/housingSync/actions/scanHash";
import type { ItemFieldContent } from "../src/housingSync/items/fieldContent";
import { observedSlot } from "./utils";
import { createItemDiffContext } from "../src/importables/items/diff";
import { createItemDependencyIndex } from "../src/importables/items/dependencyIndex";
import { createProjectItemIndex } from "../src/importables/items/projectItems";

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
    it("canonicalizes the cached and source forms of the force_accel item field equally", () => {
        const desiredAction = { type: "DROP_ITEM", itemName: "red_wool" } as Action;
        const observedAction = JSON.parse(JSON.stringify(desiredAction)) as Action;
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "force_accel",
            actions: [desiredAction],
        };
        const items = createProjectItemIndex([importable]);
        const dependencies = createItemDependencyIndex([importable], items);
        const context = createItemDiffContext(
            [importable],
            dependencies,
            items,
            "test-house",
            () => undefined
        );

        expect(context.fieldContent?.(observedAction, "itemName")).toBe(
            context.fieldContent?.(desiredAction, "itemName")
        );
        expect(
            actionListContentHashFromActions([observedAction], context.fieldContent)
        ).toBe(actionListContentHashFromActions([desiredAction], context.fieldContent));
    });

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
