import { describe, expect, it } from "vitest";

import { actionListContentHashFromActions } from "../src/housingSync/actions/scanHash";
import { scalarFieldDiffers } from "../src/housingSync/actions/comparison";

describe("content hash live/source parity", () => {
    it("treats an explicit default the same as an omitted field", () => {
        const sourceOmits = [{ type: "TITLE", title: "hi" }] as never;
        const liveFillsDefault = [
            { type: "TITLE", title: "hi", fadein: 1, stay: 5, fadeout: 1, subtitle: "" },
        ] as never;

        for (const prop of ["fadein", "stay", "fadeout", "subtitle"]) {
            expect(
                scalarFieldDiffers(
                    liveFillsDefault[0] as Record<string, unknown>,
                    sourceOmits[0] as Record<string, unknown>,
                    "TITLE",
                    prop
                )
            ).toBe(false);
        }

        expect(actionListContentHashFromActions(sourceOmits)).toBe(
            actionListContentHashFromActions(liveFillsDefault)
        );
    });

    it("treats a numeric string the same as a number", () => {
        const asNumber = [{ type: "TITLE", title: "hi", stay: 9 }] as never;
        const asString = [{ type: "TITLE", title: "hi", stay: "9" }] as never;

        expect(
            scalarFieldDiffers(
                asString[0] as Record<string, unknown>,
                asNumber[0] as Record<string, unknown>,
                "TITLE",
                "stay"
            )
        ).toBe(false);

        expect(actionListContentHashFromActions(asNumber)).toBe(
            actionListContentHashFromActions(asString)
        );
    });

    it("normalizes defaults in conditional child actions", () => {
        const sourceOmits = [
            {
                type: "CONDITIONAL",
                conditions: [],
                ifActions: [{ type: "TITLE", title: "child" }],
                elseActions: [],
            },
        ] as never;
        const liveFillsDefaults = [
            {
                type: "CONDITIONAL",
                matchAny: false,
                conditions: [],
                ifActions: [
                    {
                        type: "TITLE",
                        title: "child",
                        subtitle: "",
                        fadein: 1,
                        stay: 5,
                        fadeout: 1,
                    },
                ],
                elseActions: [],
            },
        ] as never;

        expect(actionListContentHashFromActions(sourceOmits)).toBe(
            actionListContentHashFromActions(liveFillsDefaults)
        );
    });

    it("ignores properties outside the declared lore fields", () => {
        const source = [{ type: "TITLE", title: "hi" }] as never;
        const observedWithMetadata = [
            { type: "TITLE", title: "hi", observationOnly: true },
        ] as never;

        expect(actionListContentHashFromActions(source)).toBe(
            actionListContentHashFromActions(observedWithMetadata)
        );
    });
});
