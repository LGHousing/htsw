import { describe, it, expect } from "vitest";
import type { Action } from "htsw/types";
import {
    canonicalStringify,
    normalizeActionCompare,
} from "../src/housingSync/fields/compare";
import { stableStringify } from "../src/utils/helpers";

function reference(action: Action): string {
    return stableStringify(normalizeActionCompare(action));
}

const SAMPLES: Action[] = [
    { type: "MESSAGE", message: "&aHello &r&lworld" },
    { type: "PLAY_SOUND", sound: "note.pling", volume: 1, pitch: 1 },
    {
        type: "CHANGE_VAR",
        holder: { type: "Player" },
        key: "coins",
        op: "Increment",
        value: "1,000",
    },
    {
        type: "TELEPORT",
        location: { type: "Custom Coordinates", value: "5 64 -3" },
        preventTeleportInsideBlocks: false,
    },
    {
        type: "CONDITIONAL",
        matchAny: false,
        conditions: [
            { type: "IS_SNEAKING" },
            { type: "COMPARE_HEALTH", op: "Greater Than", amount: "10" },
        ],
        ifActions: [
            { type: "MESSAGE", message: "in", note: "  a note  " },
            { type: "RANDOM", actions: [{ type: "KILL" }, { type: "HEAL" }] },
        ],
        elseActions: [{ type: "EXIT" }],
    },
    { type: "GIVE_EXPERIENCE_LEVELS", amount: "5" },
    {
        type: "TITLE",
        title: "t",
        subtitle: "s",
        fadein: 1,
        stay: 5,
        fadeout: 1,
    },
];

describe("canonicalStringify matches stableStringify(normalizeActionCompare(...))", () => {
    for (let i = 0; i < SAMPLES.length; i++) {
        const sample = SAMPLES[i];
        it(`sample ${i} (${sample.type})`, () => {
            expect(canonicalStringify(sample)).toBe(reference(sample));
        });
    }
});

describe("canonical action comparison", () => {
    it("treats parsed and observed custom coordinate locations as equal", () => {
        const parsed = {
            type: "PLAY_SOUND",
            sound: "random.orb",
            volume: 0.7,
            pitch: 1,
            location: {
                type: "Custom Coordinates",
                value: "~ ~ ~",
                coordinates: {
                    x: { kind: "relative", value: "0" },
                    y: { kind: "relative", value: "0" },
                    z: { kind: "relative", value: "0" },
                    yaw: undefined,
                    pitch: undefined,
                },
            },
        } as Action;
        const observed = {
            type: "PLAY_SOUND",
            sound: "random.orb",
            volume: "0.7",
            pitch: "1",
            location: { type: "Custom Coordinates", value: "~ ~ ~" },
        } as unknown as Action;

        expect(canonicalStringify(parsed)).toBe(canonicalStringify(observed));
    });
});
