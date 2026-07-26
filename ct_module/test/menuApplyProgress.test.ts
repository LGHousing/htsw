import { describe, expect, it } from "vitest";

import { menuApplyTotals } from "../src/importables/menus/import";
import { COST } from "../src/housingSync/progress/costs";

const ITEM_WRITE = COST.menuClickWait + COST.itemSelect;
const CLEAR = COST.menuClickWait * 2;

describe("menuApplyTotals", () => {
    it("uses the planned action diff units when they are below the content estimate", () => {
        const contentEstimate = 40;
        const plannedDiffUnits = 6.5;
        const estimated = menuApplyTotals(
            [{ syncActions: [], actionUnits: contentEstimate }],
            { exists: true, setSize: null }
        );
        const refined = menuApplyTotals(
            [{ syncActions: [], actionUnits: plannedDiffUnits }],
            { exists: true, setSize: null }
        );

        expect(refined.units).toBeCloseTo(
            estimated.units - contentEstimate + plannedDiffUnits
        );
        expect(refined.units).toBeLessThan(estimated.units);
    });

    it("uses the planned action diff units when they exceed the content estimate", () => {
        const estimated = menuApplyTotals(
            [{ syncActions: [], actionUnits: 4 }],
            { exists: true, setSize: null }
        );
        const refined = menuApplyTotals(
            [{ syncActions: [], actionUnits: 12 }],
            { exists: true, setSize: null }
        );

        expect(refined.units).toBeCloseTo(estimated.units + 8);
        expect(refined.units).toBeGreaterThan(estimated.units);
    });

    it("counts each item write, action sync, and clear as its own work item", () => {
        const r = menuApplyTotals([
            { setItem: {}, syncActions: [], actionUnits: 5 }, // 2 work items
            { setItem: {} }, //                                   1
            { syncActions: [], actionUnits: 3 }, //               1
            { clear: true }, //                                   1
        ], { exists: true, setSize: null });
        expect(r.count).toBe(7);
        expect(r.units).toBeCloseTo(
            COST.commandInterval +
                COST.commandMenuWait +
                COST.menuClickWait +
                ITEM_WRITE +
                5 +
                COST.menuClickWait +
                COST.goBackWait +
                ITEM_WRITE +
                3 +
                COST.menuClickWait +
                COST.goBackWait +
                CLEAR
        );
    });

    it("still counts an action sync that carries no unit estimate", () => {
        const r = menuApplyTotals(
            [{ syncActions: [] }],
            { exists: true, setSize: null }
        );
        expect(r.count).toBe(3);
        expect(r.units).toBeCloseTo(
            COST.commandInterval +
                COST.commandMenuWait +
                COST.menuClickWait * 2 +
                COST.goBackWait
        );
    });

    it("prices creation, resize, and entering the elements grid", () => {
        const r = menuApplyTotals(
            [{ setItem: {} }],
            { exists: false, setSize: 3 }
        );
        expect(r.count).toBe(4);
        expect(r.units).toBeCloseTo(
            COST.commandInterval +
                COST.commandMessageWait +
                COST.menuClickWait * 3 +
                ITEM_WRITE
        );
    });
});
