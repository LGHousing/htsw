import { describe, expect, test, vi } from "vitest";
import type { ActionConditional } from "htsw/types";

import { createKnownActionListPlan } from "../src/housingSync/actions/plan";
import {
    commandApplicationPlan,
    type CommandImportPlan,
} from "../src/importables/commands/import";
import {
    applyImportableFunctionPlan,
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
        ).toEqual(["verifyActions", "settings", "cache"]);
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

const functionIo = vi.hoisted(() => ({
    applied: vi.fn(async () => undefined),
    settings: vi.fn(async () => undefined),
    open: vi.fn(async () => "opened"),
    scan: vi.fn(async () => ({})),
    read: vi.fn(async () => [] as unknown[]),
    back: vi.fn(async () => undefined),
}));
vi.mock("../src/housingSync/actions/apply", async (original) => ({
    ...(await original<typeof import("../src/housingSync/actions/apply")>()),
    applyActionListPlan: functionIo.applied,
}));
vi.mock("../src/importables/functions/housing", async (original) => ({
    ...(await original<typeof import("../src/importables/functions/housing")>()),
    ensureFunctionExists: functionIo.open,
    openFunctionEditor: functionIo.open,
    openFunctionSettings: functionIo.open,
    applyFunctionSettings: functionIo.settings,
}));
vi.mock("../src/importables/functions/listFunctions", async (original) => ({
    ...(await original<typeof import("../src/importables/functions/listFunctions")>()),
    openFunctionList: functionIo.open,
}));
vi.mock("../src/housingSync/actions/readList", async (original) => ({
    ...(await original<typeof import("../src/housingSync/actions/readList")>()),
    scanActionList: functionIo.scan,
}));
vi.mock("../src/housingSync/actions/hydration/run", async (original) => ({
    ...(await original<typeof import("../src/housingSync/actions/hydration/run")>()),
    completeActionListScan: functionIo.read,
}));
vi.mock("../src/housingSync/menus/menuUtils", async (original) => ({
    ...(await original<typeof import("../src/housingSync/menus/menuUtils")>()),
    clickGoBack: functionIo.back,
}));

function directApplication() {
    return {
        run: async (_key: string, work: () => Promise<unknown>) => work(),
        runActionList: async (
            _key: string,
            _plan: unknown,
            sync: unknown,
            work: (sync: unknown) => Promise<unknown>
        ) => work(sync),
    };
}

test("conditional preflight precedes every settings write, including enabling an empty-AND lobby body", async () => {
    const old: ActionConditional = {
        type: "CONDITIONAL",
        matchAny: false,
        conditions: [],
        ifActions: [{ type: "SEND_TO_LOBBY" }],
        elseActions: [],
    };
    const desired: ActionConditional = { ...old, conditions: [{ type: "IS_SNEAKING" }] };
    const plan = {
        kind: "FUNCTION",
        exists: true,
        importable: {
            type: "FUNCTION",
            name: "Autokick",
            repeatTicks: 5,
            actions: [desired],
        },
        actionsPlan: createKnownActionListPlan([desired] as never, [old] as never, {
            sync: { trust: { trustMode: false } } as never,
        }),
        settingsPlan: [{ key: "repeatTicks", current: 0, desired: 5 }],
    } as FunctionImportPlan;
    functionIo.settings.mockClear();
    functionIo.applied.mockClear();
    await expect(
        applyImportableFunctionPlan(
            {} as never,
            plan,
            {} as never,
            directApplication() as never
        )
    ).rejects.toBeDefined();
    expect(functionIo.settings).not.toHaveBeenCalled();
    expect(functionIo.applied).not.toHaveBeenCalled();
});

test("automatic execution follows body write and a fresh matching read, and stays off when verification fails", async () => {
    const plan: FunctionImportPlan = {
        kind: "FUNCTION",
        exists: true,
        importable: {
            type: "FUNCTION",
            name: "New",
            repeatTicks: 5,
            actions: [message("after")],
        },
        actionsPlan: actionPlan("before", "after"),
        settingsPlan: [{ key: "repeatTicks", current: 0, desired: 5 }],
    };
    const session = {
        actions: { canonicalizeItemName: (name: string) => name },
    } as unknown as ImportContext;
    const order: string[] = [];
    functionIo.applied.mockImplementation(async () => {
        order.push("write");
    });
    functionIo.read.mockImplementation(async () => {
        order.push("verify");
        return [message("after")];
    });
    functionIo.settings.mockImplementation(async () => {
        order.push("enable");
    });
    await applyImportableFunctionPlan(
        {} as never,
        plan,
        session,
        directApplication() as never
    );
    expect(order).toEqual(["write", "verify", "enable"]);
    order.length = 0;
    functionIo.read.mockImplementation(async () => {
        order.push("verify");
        return [message("half edited")];
    });
    await expect(
        applyImportableFunctionPlan(
            {} as never,
            plan,
            session,
            directApplication() as never
        )
    ).rejects.toBeDefined();
    expect(order).toEqual(["write", "verify"]);
});
