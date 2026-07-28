import { describe, expect, test } from "vitest";

import { createKnownActionListPlan } from "../src/housingSync/actions/plan";
import { COST } from "../src/housingSync/progress/costs";
import {
    functionPlanApplicationUnits,
    planImportableFunction,
    type FunctionRead,
} from "../src/importables/functions/import";
import { planImportableMenu } from "../src/importables/menus/import";

import { message } from "./utils";

describe("planned importable application units", () => {
    test("function plan includes its exact action diff and settings work", () => {
        const actionsPlan = createKnownActionListPlan(
            [message("after")],
            [message("before")],
            { sync: { trust: { trustMode: false } } as never }
        );
        const read: FunctionRead = {
            kind: "FUNCTION",
            importable: {
                type: "FUNCTION",
                name: "planned",
                repeatTicks: 20,
                actions: actionsPlan.desired,
            },
            exists: true,
            actions: { kind: "planned", plan: actionsPlan },
            settings: { icon: undefined, repeatTicks: 0 },
        };

        const plan = planImportableFunction(read);

        expect(
            functionPlanApplicationUnits(plan, {
                plannedReferencedShells: {
                    functions: new Set(),
                    menus: new Set(),
                    regions: new Set(),
                },
            } as never)
        ).toBeCloseTo(
            COST.commandInterval +
                COST.commandMenuWait +
                COST.menuClickWait +
                COST.signInput +
                COST.commandInterval +
                COST.commandMenuWait +
                actionsPlan.phaseUnits.applying +
                COST.goBackWait +
                COST.cacheWrite
        );
    });

    test("menu plan includes creation and resize work before totals lock", () => {
        const read = {
            kind: "MENU" as const,
            importable: {
                type: "MENU" as const,
                name: "planned",
                size: 3,
                slots: [],
            },
            grid: null,
            slots: [],
        };

        const plan = planImportableMenu(read, {
            items: {} as never,
            actions: { itemDiff: undefined } as never,
            plannedReferencedShells: {
                functions: new Set(),
                menus: new Set(),
                regions: new Set(),
            },
        } as never);

        expect(plan.applicationPlan.totalUnits).toBeCloseTo(
            COST.commandInterval +
                COST.commandMessageWait +
                COST.menuClickWait * 2 +
                COST.cacheWrite
        );
    });
});
