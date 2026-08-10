import { describe, expect, test } from "vitest";
import type {
    Action,
    ActionPauseExecution,
    ActionPlaySound,
    ConditionCompareVar,
} from "htsw/types";

import {
    actionsEqual,
    conditionsEqual,
    scalarFieldDiffers,
} from "../src/housingSync/actions/comparison";
import { getActionScalarLoreFields } from "../src/housingSync/fields/actionMappings";
import type { Observed } from "../src/housingSync/observedActions";

import { changeVar, message, playSound } from "./utils";

function actionsCompareEqual(a: Action | Observed, b: Action): boolean {
    return actionsEqual(a, b);
}

describe("action comparison — value-kind numeric coercion", () => {
    // Lore parsing produces strings; HTSL source produces numbers. These
    // tests pin the rule: equal-magnitude string/number pairs compare equal
    // for "value"-kind fields whose declared default is numeric.
    test("string '0.7' equals number 0.7 when default is 0.7", () => {
        const observed = playSound({ volume: "0.7" as unknown as number });
        const desired = playSound({ volume: 0.7 });
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("string '1.0' equals number 1.0 when default is 1.0", () => {
        const observed = playSound({ pitch: "1.0" as unknown as number });
        const desired = playSound({ pitch: 1.0 });
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("string and number coerce equal even when not at default", () => {
        const observed = playSound({ volume: "0.5" as unknown as number });
        const desired = playSound({ volume: 0.5 });
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("different numeric values still differ", () => {
        const observed = playSound({ volume: "0.5" as unknown as number });
        const desired = playSound({ volume: 0.7 });
        expect(actionsCompareEqual(observed, desired)).toBe(false);
    });

    test.each([
        [0.0025, 0.003],
        [0.0015, 0.002],
        [0.0625, 0.062],
        [1234.56789, 1234.568],
    ])("number %s compares as displayed %s", (input, displayed) => {
        expect(
            actionsCompareEqual(playSound({ pitch: input }), playSound({ pitch: displayed }))
        ).toBe(true);
    });

    test.each([
        ["0.0025", "0.003"],
        ["0.0015", "0.002"],
        ["0.0625", "0.062"],
        ["1234.56789", "1234.568"],
    ])("numeric display %s compares as displayed %s", (input, displayed) => {
        expect(
            actionsCompareEqual(changeVar({ value: input }), changeVar({ value: displayed }))
        ).toBe(true);
    });

    test("malformed numeric strings stay as strings (no permissive coerce)", () => {
        // Guards against parseFloat-style permissive parsing: "0.7x" must
        // not collapse to 0.7 and falsely match the default.
        const observed = playSound({ volume: "0.7x" as unknown as number });
        const desired = playSound({ volume: 0.7 });
        expect(actionsCompareEqual(observed, desired)).toBe(false);
    });

    test("required numeric PAUSE ticks compare from lore string to source number", () => {
        const observed: ActionPauseExecution = {
            type: "PAUSE",
            ticks: "1" as unknown as number,
        };
        const desired: ActionPauseExecution = {
            type: "PAUSE",
            ticks: 1,
        };
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("large variable integers compare as exact text", () => {
        expect(
            actionsCompareEqual(
                changeVar({ value: "4466842338629" }),
                changeVar({ value: "9999999999999" })
            )
        ).toBe(false);
        expect(
            actionsCompareEqual(
                changeVar({ value: "10000000000000" }),
                changeVar({ value: "10000000000001" })
            )
        ).toBe(false);
    });

    test("variable integers above JS safe precision do not collapse", () => {
        const observed = changeVar({ value: "10000000000000000" });
        const desired = changeVar({ value: "10000000000000001" });
        expect(actionsCompareEqual(observed, desired)).toBe(false);
    });

    test("large variable integer display commas normalize without Number coercion", () => {
        const observed = changeVar({ value: "10,000,000,000,001" });
        const desired = changeVar({ value: "10000000000001" });
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("numeric-display values still normalize before whitespace handling", () => {
        expect(
            actionsCompareEqual(
                changeVar({ value: "10,000.0" }),
                changeVar({ value: "10000.0" })
            )
        ).toBe(true);
    });
});

describe("action comparison — Housing input canonicalization", () => {
    test("value fields compare equal after Housing collapses interior spaces", () => {
        const observed = changeVar({ value: "accelerate &8| &7Left-click" });
        const desired = changeVar({ value: "accelerate  &8|  &7Left-click" });
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("vanilla item references compare equal to their observed display name", () => {
        const observed = { type: "DROP_ITEM", itemName: "Wool" } as Action;
        const desired = { type: "DROP_ITEM", itemName: "white_wool" } as Action;
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("modern Housing sound labels compare equal to their sound keys", () => {
        const observed = playSound({
            sound: "Item Flintandsteel Use" as unknown as ActionPlaySound["sound"],
        });
        const desired = playSound({
            sound: "item.flintandsteel.use" as unknown as ActionPlaySound["sound"],
        });

        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });
});

describe("action comparison — select/cycle shape coercion", () => {
    // Lore parsing produces a bare string for select/cycle fields; HTSL
    // source produces { type: "<label>" } objects. These tests pin the
    // rule: both shapes collapse to the same canonical form.
    test("string 'Invokers Location' equals { type: 'Invokers Location' }", () => {
        const observed = playSound({
            location: "Invokers Location" as unknown as ActionPlaySound["location"],
        });
        const desired = playSound({ location: { type: "Invokers Location" } });
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("default 'Not Set' string == { type: 'Not Set' } object — both drop", () => {
        const observed = playSound({
            location: "Not Set" as unknown as ActionPlaySound["location"],
        });
        const desired = playSound({
            location: { type: "Not Set" } as unknown as ActionPlaySound["location"],
        });
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("missing field on desired side equals default-valued observed field", () => {
        const observed = playSound({
            location: "Not Set" as unknown as ActionPlaySound["location"],
        });
        const desired = playSound(); // no location at all
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("different select values still differ", () => {
        const observed = playSound({
            location: "Invokers Location" as unknown as ActionPlaySound["location"],
        });
        const desired = playSound({ location: { type: "House Spawn Location" } });
        expect(actionsCompareEqual(observed, desired)).toBe(false);
    });

    test("Sound field (select with no default) — string vs object both wrap", () => {
        const observed = playSound({
            sound: "random.anvil_land" as unknown as ActionPlaySound["sound"],
        });
        const desired = playSound({
            sound: "random.anvil_land" as unknown as ActionPlaySound["sound"],
        });
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });
});

describe("action comparison — boolean default-drop", () => {
    test("CHANGE_VAR.unset = false equals omitted unset", () => {
        const observed = changeVar({ unset: false });
        const desired = changeVar(); // unset omitted
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("unset = true is not equal to omitted unset", () => {
        const observed = changeVar({ unset: true });
        const desired = changeVar();
        expect(actionsCompareEqual(observed, desired)).toBe(false);
    });
});

describe("action comparison — VarHolder team", () => {
    test("Team holder with same team matches", () => {
        const observed = changeVar({ holder: { type: "Team", team: "Blue" } });
        const desired = changeVar({ holder: { type: "Team", team: "Blue" } });
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("Team holder with different team differs", () => {
        const observed = changeVar({ holder: { type: "Team", team: "Blue" } });
        const desired = changeVar({ holder: { type: "Team", team: "Red" } });
        expect(actionsCompareEqual(observed, desired)).toBe(false);
    });

    test("Player holder differs from Team holder", () => {
        const observed = changeVar({ holder: { type: "Player" } });
        const desired = changeVar({ holder: { type: "Team", team: "Blue" } });
        expect(actionsCompareEqual(observed, desired)).toBe(false);
    });
});

describe("action comparison — note handling", () => {
    test("identical notes match", () => {
        const observed = message("hello", { note: "&7notes" });
        const desired = message("hello", { note: "&7notes" });
        expect(actionsCompareEqual(observed, desired)).toBe(true);
    });

    test("different notes differ", () => {
        const observed = message("hello", { note: "&7original" });
        const desired = message("hello", { note: "&7updated" });
        expect(actionsCompareEqual(observed, desired)).toBe(false);
    });
});

describe("condition comparison — same machinery as actions", () => {
    test.each(["Not Set", '"Not Set"'])(
        "observed default fallback %s equals an omitted desired field",
        (fallback) => {
            const observed: ConditionCompareVar = {
                type: "COMPARE_VAR",
                holder: { type: "Player" },
                var: "x",
                op: "Equal",
                amount: "1",
                fallback,
            };
            const desired: ConditionCompareVar = {
                type: "COMPARE_VAR",
                holder: { type: "Player" },
                var: "x",
                op: "Equal",
                amount: "1",
            };
            expect(conditionsEqual(observed, desired)).toBe(true);
        }
    );

    test("a genuinely different fallback does not equal an omitted field", () => {
        const observed: ConditionCompareVar = {
            type: "COMPARE_VAR",
            holder: { type: "Player" },
            var: "x",
            op: "Equal",
            amount: "1",
            fallback: '"0"',
        };
        const desired: ConditionCompareVar = {
            type: "COMPARE_VAR",
            holder: { type: "Player" },
            var: "x",
            op: "Equal",
            amount: "1",
        };
        expect(conditionsEqual(observed, desired)).toBe(false);
    });
});

describe("canonical action keys", () => {
    test("parsed and observed custom coordinate locations compare equally", () => {
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

        expect(actionsEqual(parsed, observed)).toBe(true);
    });
});

describe("scalarFieldDiffers — scalar field comparison", () => {
    test("equal actions report no scalar change", () => {
        const observed = playSound({ volume: 0.7, pitch: 1.0 });
        const desired = playSound({ volume: 0.7, pitch: 1.0 });
        expect(scalarFieldDiffers(observed, desired, observed.type, "volume")).toBe(
            false
        );
        expect(scalarFieldDiffers(observed, desired, observed.type, "pitch")).toBe(false);
    });

    test("string and number forms of defaultable fields collapse to no change", () => {
        const observed = playSound({
            volume: "0.7" as unknown as number,
            pitch: "1.0" as unknown as number,
            location: "Invokers Location" as unknown as ActionPlaySound["location"],
        });
        const desired = playSound({
            volume: 0.7,
            pitch: 1.0,
            location: { type: "Invokers Location" },
        });
        expect(scalarFieldDiffers(observed, desired, observed.type, "volume")).toBe(
            false
        );
        expect(scalarFieldDiffers(observed, desired, observed.type, "pitch")).toBe(false);
        expect(scalarFieldDiffers(observed, desired, observed.type, "location")).toBe(
            false
        );
    });

    test("real differences report a scalar change", () => {
        const observed = playSound({
            volume: "0.5" as unknown as number,
        });
        const desired = playSound({ volume: 0.9 });
        expect(scalarFieldDiffers(observed, desired, observed.type, "volume")).toBe(true);
    });

    test("childList fields are excluded from the scalar prop list", () => {
        const props = getActionScalarLoreFields("CONDITIONAL");
        for (const p of props) {
            expect(p.kind).not.toBe("actionList");
            expect(p.kind).not.toBe("conditionList");
        }
    });
});
