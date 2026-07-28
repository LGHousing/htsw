import * as htsw from "htsw";
import { describe, expect, test } from "vitest";

import { writeItemTagsEqual } from "../src/housingSync/items/itemPicker";
import type { TagLike } from "../src/housingSync/items/itemTag";
import {
    extractInteractDataSnbtFromNbt,
    itemNbtWithInteractData,
} from "../src/utils/nbt";

const str = (value: string): TagLike => ({ type: "string", value });
const byte = (value: number): TagLike => ({ type: "byte", value });
const compound = (value: Record<string, TagLike>): TagLike => ({
    type: "compound",
    value,
});

function item(interactData?: TagLike): TagLike {
    return compound({
        id: str("minecraft:stone"),
        tag: compound({
            ExtraAttributes:
                interactData === undefined
                    ? compound({})
                    : compound({ interact_data: interactData }),
        }),
    });
}

describe("writeItemTagsEqual", () => {
    test("rejects a blob-less candidate for a desired click-action item", () => {
        expect(writeItemTagsEqual(item(), item(compound({ version: byte(1) })))).toBe(
            false
        );
    });

    test("accepts a candidate with the exact desired click-action blob", () => {
        const candidate = item(compound({ version: byte(1), action: str("chat") }));
        const desired = item(compound({ version: byte(1), action: str("chat") }));
        expect(writeItemTagsEqual(candidate, desired)).toBe(true);
    });

    test("rejects a blob-carrying candidate for a desired plain item", () => {
        expect(writeItemTagsEqual(item(compound({ version: byte(1) })), item())).toBe(
            false
        );
    });

    test("keeps a genuinely blob-less desired item reusable only from plain inventory", () => {
        expect(writeItemTagsEqual(item(), item())).toBe(true);
    });

    test("rejects a canonical shell mismatch", () => {
        const stone = item();
        const dirt = compound({ id: str("minecraft:dirt") });
        expect(writeItemTagsEqual(dirt, stone)).toBe(false);
    });

    test("splices house knowledge into the desired form used for matching and injection", () => {
        const source = htsw.nbt.parseSnbtText('{id:"minecraft:stone"}');
        const interactData = '{version:1b,actions:[{type:"chat"}]}';
        const desired = itemNbtWithInteractData(source, interactData);
        const blobbedCandidate = htsw.nbt.parseSnbtText(
            '{id:"minecraft:stone",tag:{ExtraAttributes:{interact_data:{version:1b,actions:[{type:"chat"}]}}}}'
        );

        expect(extractInteractDataSnbtFromNbt(desired)).toBe(interactData);
        expect(writeItemTagsEqual(blobbedCandidate, desired)).toBe(true);
        expect(writeItemTagsEqual(source, desired)).toBe(false);
    });
});
