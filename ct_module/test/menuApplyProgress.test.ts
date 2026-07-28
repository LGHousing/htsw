import { describe, expect, it } from "vitest";

import type { ActionSyncContext } from "../src/housingSync/actions/syncContext";
import { createKnownActionListPlan } from "../src/housingSync/actions/plan";
import { COST } from "../src/housingSync/progress/costs";
import type { SyncEvent } from "../src/housingSync/syncEvents";
import { ApplicationProgress } from "../src/importables/import/applicationProgress";
import {
    menuApplicationPlan,
    menuApplyWorkCount,
    type MenuImportPlan,
} from "../src/importables/menus/import";

import { conditional, message } from "./utils";

describe("menu application progress", () => {
    it("counts each item write, action sync, and clear as its own work item", () => {
        const count = menuApplyWorkCount(
            [
                { setItem: {}, syncActions: [] },
                { setItem: {} },
                { syncActions: [] },
                { clear: true },
            ],
            { setSize: null }
        );
        expect(count).toBe(7);
    });

    it("counts an action sync independently of its cost model", () => {
        const count = menuApplyWorkCount([{ syncActions: [] }], { setSize: null });
        expect(count).toBe(3);
    });

    it("counts creation, resize, elements entry, and the slot operation", () => {
        const count = menuApplyWorkCount([{ setItem: {} }], { setSize: 3 });
        expect(count).toBe(4);
    });

    it("uses the exact action plan without re-counting its read and hydration", () => {
        const basePlan = menuSlotActionPlan();
        const actionsPlan = {
            ...basePlan,
            phaseUnits: {
                ...basePlan.phaseUnits,
                reading: 40,
                hydrating: 15,
            },
        };
        const plan = menuPlanWithActions(actionsPlan);

        const actionStep = plan.applicationPlan.steps.find(
            (step) => step.kind === "actionList"
        );
        expect(actionStep?.units).toBeCloseTo(actionsPlan.phaseUnits.applying);
        expect(plan.applicationPlan.totalUnits).toBeCloseTo(
            COST.commandInterval +
                COST.commandMenuWait +
                COST.menuClickWait +
                COST.menuClickWait +
                actionsPlan.phaseUnits.applying +
                COST.goBackWait +
                COST.cacheWrite
        );
    });

    it("prices a globally planned menu shell as an existing-menu open", () => {
        const plan = {
            kind: "MENU" as const,
            importable: {
                type: "MENU" as const,
                name: "planned",
                size: 3,
                slots: [],
            },
            exists: false,
            diff: { setSize: 3, ops: [] },
        };
        const applicationPlan = menuApplicationPlan(plan, {
            plannedReferencedShells: {
                functions: new Set(),
                menus: new Set(["planned"]),
                regions: new Set(),
            },
        } as never);

        expect(applicationPlan.steps[0]).toEqual({
            key: "menu",
            kind: "work",
            units: COST.commandInterval + COST.commandMenuWait,
        });
    });

    it("maps top-level and conditional-child progress through the menu ledger", async () => {
        const basePlan = menuSlotActionPlan();
        const actionsPlan = {
            ...basePlan,
            phaseUnits: {
                ...basePlan.phaseUnits,
                reading: 30,
                hydrating: 12,
            },
        };
        const plan = menuPlanWithActions(actionsPlan);
        const completed: number[] = [];
        const events = {
            emit: (event: SyncEvent) => {
                if (event.kind === "applicationProgress") {
                    completed.push(event.completedUnits);
                }
            },
        };
        const application = new ApplicationProgress(plan.applicationPlan, events);
        const sync = { events } as unknown as ActionSyncContext;

        await application.run("menu", async () => undefined);
        await application.run("elements", async () => undefined);
        await application.run("slot:9:actions:open", async () => undefined);
        const beforeList = completed[completed.length - 1];
        const partial = actionsPlan.phaseUnits.applying / 4;
        await application.runActionList(
            "slot:9:actions:list",
            actionsPlan,
            sync,
            async (listSync) => {
                listSync.events?.emit({
                    kind: "progress",
                    scope: { kind: "topLevel" },
                    progress: {
                        phase: "applying",
                        completedUnits:
                            actionsPlan.phaseUnits.reading +
                            actionsPlan.phaseUnits.hydrating,
                        totalUnits:
                            actionsPlan.phaseUnits.reading +
                            actionsPlan.phaseUnits.hydrating +
                            actionsPlan.phaseUnits.applying,
                        phaseUnits: actionsPlan.phaseUnits,
                        sync: { completedUnits: 0, totalUnits: 1, parent: null },
                    },
                });
                listSync.events?.emit({
                    kind: "progress",
                    scope: {
                        kind: "childList",
                        path: { kind: "actionList", parts: [0, "ifActions"] },
                        baselineApplyUnits: partial,
                        parentSync: { completedUnits: 0, totalUnits: 1 },
                    },
                    progress: {
                        phase: "applying",
                        completedUnits: partial,
                        totalUnits: partial * 2,
                        phaseUnits: {
                            setup: 0,
                            reading: 0,
                            hydrating: 0,
                            applying: partial * 2,
                        },
                        sync: { completedUnits: 0, totalUnits: 1, parent: null },
                    },
                });
            }
        );

        expect(completed.slice(-3)).toEqual([
            beforeList,
            beforeList + partial * 2,
            beforeList + actionsPlan.phaseUnits.applying,
        ]);
    });
});

function menuSlotActionPlan() {
    return createKnownActionListPlan(
        [
            conditional({
                ifActions: [message("one"), message("two")],
                elseActions: [message("else")],
            }),
        ],
        [
            conditional({
                ifActions: [message("old")],
                elseActions: [],
            }),
        ],
        { sync: { trust: { trustMode: false } } as never }
    );
}

function menuPlanWithActions(
    actionsPlan: ReturnType<typeof menuSlotActionPlan>
): MenuImportPlan {
    const plan = {
        kind: "MENU" as const,
        importable: {
            type: "MENU" as const,
            name: "planned",
            size: 1,
            slots: [],
        },
        exists: true,
        diff: {
            setSize: null,
            ops: [
                {
                    slot: 9,
                    syncActions: actionsPlan.desired,
                    actionsPlan,
                },
            ],
        },
    };
    return {
        ...plan,
        applicationPlan: menuApplicationPlan(plan),
    };
}
