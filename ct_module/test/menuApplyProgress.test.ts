import { describe, expect, it } from "vitest";

import { menuApplyTotals } from "../src/importables/menus/import";
import { COST } from "../src/housingSync/progress/costs";

const ITEM_WRITE = COST.menuClickWait + COST.itemSelect;
const CLEAR = COST.menuClickWait * 2;

describe("menuApplyTotals", () => {
    it("counts each item write, action sync, and clear as its own work item", () => {
        const r = menuApplyTotals([
            { setItem: {}, syncActions: [], actionUnits: 5 }, // 2 work items
            { setItem: {} }, //                                   1
            { syncActions: [], actionUnits: 3 }, //               1
            { clear: true }, //                                   1
        ]);
        expect(r.count).toBe(5);
        expect(r.units).toBeCloseTo(ITEM_WRITE + 5 + ITEM_WRITE + 3 + CLEAR);
    });

    it("still counts an action sync that carries no unit estimate", () => {
        const r = menuApplyTotals([{ syncActions: [] }]);
        expect(r.count).toBe(1);
        expect(r.units).toBe(0);
    });

    it("is empty for no ops", () => {
        expect(menuApplyTotals([])).toEqual({ count: 0, units: 0 });
    });
});
