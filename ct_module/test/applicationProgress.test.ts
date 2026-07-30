import { describe, expect, test } from "vitest";

import type { ActionSyncContext } from "../src/housingSync/actions/syncContext";
import type { SyncEvent } from "../src/housingSync/syncEvents";
import {
    actionListStep,
    ApplicationProgress,
    defineApplicationPlan,
    workStep,
} from "../src/importables/import/applicationProgress";

describe("application progress", () => {
    test("combines outer work and sequential action lists into one cumulative value", async () => {
        const events: SyncEvent[] = [];
        const first = actionPlan(40, 10, 5);
        const second = actionPlan(20, 4, 6);
        const application = new ApplicationProgress(
            defineApplicationPlan([
                workStep("open", 3),
                actionListStep("first", first),
                workStep("between", 2),
                actionListStep("second", second),
                workStep("cache", 0.25),
            ]),
            { emit: (event) => events.push(event) }
        );
        const sync = {
            events: { emit: (event: SyncEvent) => events.push(event) },
        } as unknown as ActionSyncContext;

        await application.run("open", async () => undefined);
        await application.runActionList("first", first, sync, async (listSync) => {
            listSync.events?.emit(progress(25, 40, 10, 5));
            listSync.events?.emit(progress(55, 40, 10, 5));
        });
        await application.run("between", async () => undefined);
        await application.runActionList("second", second, sync, async (listSync) => {
            listSync.events?.emit(progress(10, 20, 4, 6));
            listSync.events?.emit(progress(30, 20, 4, 6));
        });
        await application.run("cache", async () => undefined);
        application.assertComplete();

        expect(
            events
                .filter(
                    (
                        event
                    ): event is Extract<SyncEvent, { kind: "applicationProgress" }> =>
                        event.kind === "applicationProgress"
                )
                .map((event) => event.completedUnits)
        ).toEqual([3, 13, 43, 43, 45, 45, 65, 65, 65.25]);
        expect(events.some((event) => event.kind === "progress")).toBe(false);
    });

    test("maps child-list progress onto its parent action-list step", async () => {
        const progressEvents: Extract<SyncEvent, { kind: "applicationProgress" }>[] = [];
        const plan = actionPlan(30, 12, 8);
        const application = new ApplicationProgress(
            defineApplicationPlan([workStep("open", 4), actionListStep("actions", plan)]),
            {
                emit: (event) => {
                    if (event.kind === "applicationProgress") {
                        progressEvents.push(event);
                    }
                },
            }
        );
        const sync = {
            events: { emit: () => undefined },
        } as unknown as ActionSyncContext;

        await application.run("open", async () => undefined);
        await application.runActionList("actions", plan, sync, async (listSync) => {
            listSync.events?.emit({
                ...progress(7, 7, 0, 0),
                scope: {
                    kind: "childList",
                    path: { kind: "actionList", parts: [0, "ifActions"] },
                    baselineApplyUnits: 9,
                    parentSync: { completedUnits: 1, totalUnits: 2 },
                },
            });
        });

        expect(progressEvents.map((event) => event.completedUnits)).toEqual([4, 20, 34]);
        expect(progressEvents[1].sync?.parent).toEqual({
            completedUnits: 1,
            totalUnits: 2,
        });
    });
});

function actionPlan(applying: number, reading: number, hydrating: number) {
    return {
        desired: [],
        observed: [],
        diff: { operations: [], desiredLength: 0 },
        phaseUnits: { setup: 0, reading, hydrating, applying },
    };
}

function progress(
    completedUnits: number,
    applying: number,
    reading: number,
    hydrating: number
): Extract<SyncEvent, { kind: "progress" }> {
    return {
        kind: "progress",
        scope: { kind: "topLevel" },
        progress: {
            phase: "applying",
            completedUnits,
            totalUnits: reading + hydrating + applying,
            phaseUnits: { setup: 0, reading, hydrating, applying },
            sync: { completedUnits: 1, totalUnits: 2, parent: null },
        },
    };
}
