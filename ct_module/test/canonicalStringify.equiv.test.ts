import { describe, it, expect } from "vitest";
import type { Action } from "htsw/types";
import { canonicalStringify, normalizeActionCompare } from "../src/housingSync/fields/compare";
import { stableStringify } from "../src/utils/helpers";

function reference(action: Action): string {
    return stableStringify(normalizeActionCompare(action));
}

const SAMPLES: Action[] = [
    { type: "MESSAGE", message: "&aHello &r&lworld" } as Action,
    { type: "PLAY_SOUND", sound: "note.pling", volume: 1, pitch: 1 } as Action,
    { type: "CHANGE_VAR", holder: { type: "Player" }, key: "coins", op: "Increment", value: "1,000" } as Action,
    { type: "TELEPORT", location: { type: "Custom Coordinates", value: "5 64 -3" }, preventTeleportInsideBlocks: false } as Action,
    {
        type: "CONDITIONAL",
        matchAny: false,
        conditions: [{ type: "IS_SNEAKING" }, { type: "COMPARE_HEALTH", op: "Greater Than", amount: "10" }],
        ifActions: [
            { type: "MESSAGE", message: "in", note: "  a note  " },
            { type: "RANDOM", actions: [{ type: "KILL" }, { type: "HEAL" }] },
        ],
        elseActions: [{ type: "EXIT" }],
    } as Action,
    { type: "GIVE_EXPERIENCE_LEVELS", amount: "5" } as Action,
    { type: "TITLE", title: "t", subtitle: "s", fadein: 1, stay: 5, fadeout: 1 } as Action,
];

describe("canonicalStringify matches stableStringify(normalizeActionCompare(...))", () => {
    for (let i = 0; i < SAMPLES.length; i++) {
        const sample = SAMPLES[i];
        it(`sample ${i} (${sample.type})`, () => {
            expect(canonicalStringify(sample)).toBe(reference(sample));
        });
    }
});
