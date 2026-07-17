import { describe, expect, it } from "vitest";
import type { Action } from "htsw/types";

import {
    actionListScanHashFromActions,
    actionListScanHashFromSlots,
} from "../src/housingSync/actions/scanHash";
import type { ObservedActionSlot } from "../src/housingSync/observedActions";
import {
    changeVar,
    conditional,
    message,
    observedSlot,
    playSound,
    random,
} from "./utils";

function scannedSlot(
    index: number,
    type: Action["type"],
    childListSummaries?: ObservedActionSlot["childListSummaries"]
): ObservedActionSlot {
    return {
        ...observedSlot(index, { type } as NonNullable<ObservedActionSlot["action"]>),
        hydrated: false,
        childListSummaries,
    };
}

describe("action-list scan hashes", () => {
    it("projects the same hash as a scan with conditional, random, and plain actions", () => {
        const actions: Action[] = [
            message("hello"),
            conditional({
                conditions: [{ type: "IS_SNEAKING" }],
                ifActions: [playSound()],
                elseActions: [changeVar()],
            }),
            random({ actions: [message("one"), playSound()] }),
            changeVar(),
        ];
        const slots = [
            scannedSlot(0, "MESSAGE"),
            scannedSlot(1, "CONDITIONAL", {
                conditions: ["IS_SNEAKING"],
                ifActions: ["PLAY_SOUND"],
                elseActions: ["CHANGE_VAR"],
            }),
            scannedSlot(2, "RANDOM", {
                actions: ["MESSAGE", "PLAY_SOUND"],
            }),
            scannedSlot(3, "CHANGE_VAR"),
        ];

        expect(actionListScanHashFromSlots(slots)).toBe(
            actionListScanHashFromActions(actions)
        );
    });

    it("normalizes empty and absent child-list summaries", () => {
        const absent = [scannedSlot(0, "CONDITIONAL")];
        const empty = [
            scannedSlot(0, "CONDITIONAL", {
                conditions: [],
                ifActions: [],
                elseActions: [],
            }),
        ];
        const projection = [conditional()];

        expect(actionListScanHashFromSlots(absent)).toBe(
            actionListScanHashFromSlots(empty)
        );
        expect(actionListScanHashFromSlots(empty)).toBe(
            actionListScanHashFromActions(projection)
        );
    });

    it("keeps an unparseable slot distinct from projected actions", () => {
        const unreadable: ObservedActionSlot = {
            ...observedSlot(0, message("ignored")),
            action: null,
            hydrated: false,
        };
        const hash = actionListScanHashFromSlots([unreadable]);

        expect(hash).not.toBe(actionListScanHashFromActions([]));
        expect(hash).not.toBe(actionListScanHashFromActions([message("hello")]));
        expect(hash).not.toBe(actionListScanHashFromActions([conditional()]));
    });

    it("changes for reorder, add, remove, and changed child types", () => {
        const first = message("first");
        const second = playSound();
        const base = actionListScanHashFromActions([first, second]);

        expect(actionListScanHashFromActions([second, first])).not.toBe(base);
        expect(actionListScanHashFromActions([first, second, changeVar()])).not.toBe(
            base
        );
        expect(actionListScanHashFromActions([first])).not.toBe(base);

        const conditionalMessage = actionListScanHashFromActions([
            conditional({ ifActions: [message("child")] }),
        ]);
        const conditionalVariable = actionListScanHashFromActions([
            conditional({ ifActions: [changeVar()] }),
        ]);
        expect(conditionalVariable).not.toBe(conditionalMessage);
    });
});
