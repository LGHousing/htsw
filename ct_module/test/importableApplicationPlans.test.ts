import { describe, expect, test } from "vitest";

import { createKnownActionListPlan } from "../src/housingSync/actions/plan";
import {
    commandApplicationPlan,
    type CommandImportPlan,
} from "../src/importables/commands/import";
import {
    functionApplicationPlan,
    type FunctionImportPlan,
} from "../src/importables/functions/import";
import type { ImportContext } from "../src/importables/import/context";
import {
    regionApplicationPlan,
    type RegionImportPlan,
} from "../src/importables/regions/import";

import { message } from "./utils";

function actionPlan(before: string, after: string) {
    return createKnownActionListPlan([message(after)], [message(before)], {
        sync: { trust: { trustMode: false } } as never,
    });
}

function emptyActionPlan() {
    return createKnownActionListPlan([], [], {
        sync: { trust: { trustMode: false } } as never,
    });
}

function sessionWithPlannedShells(
    functions: readonly string[] = [],
    regions: readonly string[] = []
): ImportContext {
    return {
        plannedReferencedShells: {
            functions: new Set(functions),
            menus: new Set<string>(),
            regions: new Set(regions),
        },
    } as ImportContext;
}

describe("importable application plans", () => {
    test("no-op function and command plans contain only the cache step", () => {
        const functionPlan: FunctionImportPlan = {
            kind: "FUNCTION",
            importable: {
                type: "FUNCTION",
                name: "unchanged",
                actions: [],
            },
            actionsPlan: emptyActionPlan(),
            settingsPlan: [],
            exists: true,
        };
        const commandPlan: CommandImportPlan = {
            kind: "COMMAND",
            importable: {
                type: "COMMAND",
                name: "unchanged",
                actions: [],
            },
            actionsPlan: emptyActionPlan(),
            settings: {
                mode: "Self",
                requiredPriority: 0,
                listed: true,
            },
            settingsHandled: true,
            exists: true,
        };

        expect(
            functionApplicationPlan(functionPlan, sessionWithPlannedShells()).steps.map(
                (step) => step.key
            )
        ).toEqual(["cache"]);
        expect(commandApplicationPlan(commandPlan).steps.map((step) => step.key)).toEqual(
            ["cache"]
        );
    });

    test("a planned referenced function shell is not budgeted a second time", () => {
        const plan: FunctionImportPlan = {
            kind: "FUNCTION",
            importable: {
                type: "FUNCTION",
                name: "referenced",
                actions: [message("after")],
            },
            actionsPlan: actionPlan("before", "after"),
            settingsPlan: [],
            exists: false,
        };

        expect(
            functionApplicationPlan(
                plan,
                sessionWithPlannedShells(["referenced"])
            ).steps.map((step) => step.key)
        ).toEqual(["openActions", "actions", "closeActions", "cache"]);
        expect(
            functionApplicationPlan(plan, sessionWithPlannedShells()).steps.map(
                (step) => step.key
            )
        ).toEqual(["createShell", "openActions", "actions", "closeActions", "cache"]);
    });

    test("function settings do not plan a close step after Housing exits the editor", () => {
        const plan: FunctionImportPlan = {
            kind: "FUNCTION",
            importable: {
                type: "FUNCTION",
                name: "settings",
                actions: [],
                repeatTicks: 40,
            },
            actionsPlan: emptyActionPlan(),
            settingsPlan: [{ key: "repeatTicks", current: 20, desired: 40 }],
            exists: true,
        };

        expect(
            functionApplicationPlan(plan, sessionWithPlannedShells()).steps.map(
                (step) => step.key
            )
        ).toEqual(["settings", "cache"]);
    });

    test("region entry and exit lists have distinct ordered application steps", () => {
        const enterPlan = actionPlan("enter before", "enter after");
        const exitPlan = actionPlan("exit before", "exit after");
        const plan: RegionImportPlan = {
            kind: "REGION",
            importable: {
                type: "REGION",
                name: "planned",
                bounds: {
                    from: { x: 0, y: 0, z: 0 },
                    to: { x: 1, y: 1, z: 1 },
                },
                onEnterActions: enterPlan.desired,
                onExitActions: exitPlan.desired,
            },
            liveRegion: {
                index: 0,
                name: "planned",
                bounds: {
                    from: { x: 0, y: 0, z: 0 },
                    to: { x: 1, y: 1, z: 1 },
                },
            },
            boundsMatch: true,
            enterPlan,
            exitPlan,
        };

        const application = regionApplicationPlan(plan, sessionWithPlannedShells());

        expect(application.steps.map((step) => step.key)).toEqual([
            "openEditor",
            "openEnterActions",
            "enterActions",
            "reopenForExit",
            "openExitActions",
            "exitActions",
            "cache",
        ]);
        expect(application.steps.find((step) => step.key === "enterActions")?.units).toBe(
            enterPlan.phaseUnits.applying
        );
        expect(application.steps.find((step) => step.key === "exitActions")?.units).toBe(
            exitPlan.phaseUnits.applying
        );
    });
});
