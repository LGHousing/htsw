import { describe, expect, test } from "vitest";
import type { Action, ActionPlaySound, ConditionCompareVar } from "htsw/types";

import {
    normalizeActionCompare,
    normalizeConditionCompare,
    scalarFieldDiffers,
} from "../src/importer/fields/compare";
import { getActionScalarLoreFields } from "../src/importer/fields/actionMappings";
import type { Observed } from "../src/importer/types";

import { changeVar, message, playSound } from "./utils";

function actionsCompareEqual(a: Action | Observed<Action>, b: Action): boolean {
    return (
        JSON.stringify(normalizeActionCompare(a)) ===
        JSON.stringify(normalizeActionCompare(b))
    );
}

describe("normalizeActionCompare — value-kind numeric coercion", () => {
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

    test("malformed numeric strings stay as strings (no permissive coerce)", () => {
        // Guards against parseFloat-style permissive parsing: "0.7x" must
        // not collapse to 0.7 and falsely match the default.
        const observed = playSound({ volume: "0.7x" as unknown as number });
        const desired = playSound({ volume: 0.7 });
        expect(actionsCompareEqual(observed, desired)).toBe(false);
    });
});

describe("normalizeActionCompare — select/cycle shape coercion", () => {
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

describe("normalizeActionCompare — boolean default-drop", () => {
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

describe("normalizeActionCompare — VarHolder team", () => {
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

describe("normalizeActionCompare — note handling", () => {
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

describe("normalizeConditionCompare — same machinery as actions", () => {
    test("COMPARE_VAR with default fallback drops the field", () => {
        const observed: ConditionCompareVar = {
            type: "COMPARE_VAR",
            holder: { type: "Player" },
            var: "x",
            op: "Equal",
            amount: "1",
            fallback: "Not Set",
        };
        const desired: ConditionCompareVar = {
            type: "COMPARE_VAR",
            holder: { type: "Player" },
            var: "x",
            op: "Equal",
            amount: "1",
        };
        expect(JSON.stringify(normalizeConditionCompare(observed))).toBe(
            JSON.stringify(normalizeConditionCompare(desired))
        );
    });
});

describe("scalarFieldDiffers — scalar field comparison", () => {
    test("equal actions report no scalar change", () => {
        const observed = playSound({ volume: 0.7, pitch: 1.0 });
        const desired = playSound({ volume: 0.7, pitch: 1.0 });
        expect(scalarFieldDiffers(observed, desired, observed.type, "volume")).toBe(false);
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
        expect(scalarFieldDiffers(observed, desired, observed.type, "volume")).toBe(false);
        expect(scalarFieldDiffers(observed, desired, observed.type, "pitch")).toBe(false);
        expect(scalarFieldDiffers(observed, desired, observed.type, "location")).toBe(false);
    });

    test("real differences report a scalar change", () => {
        const observed = playSound({
            volume: "0.5" as unknown as number,
        });
        const desired = playSound({ volume: 0.9 });
        expect(scalarFieldDiffers(observed, desired, observed.type, "volume")).toBe(true);
    });

    test("nestedList fields are excluded from the scalar prop list", () => {
        const props = getActionScalarLoreFields("CONDITIONAL");
        for (const p of props) {
            expect(p.kind).not.toBe("nestedList");
        }
    });
});
