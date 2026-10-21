import { afterEach, describe, expect, test, vi } from "vitest";

import {
    planFunctionSettingChanges,
    type ObservedFunctionSettings,
} from "../src/importables/functions/settings";

const current: ObservedFunctionSettings = {
    description: "Runs every second.",
    icon: undefined,
    repeatTicks: 0,
};

describe("function description settings", () => {
    test("preserves omitted descriptions and matches Housing's appended period", () => {
        expect(
            planFunctionSettingChanges(current, {
                type: "FUNCTION",
                name: "Tick",
            })
        ).toEqual([]);
        expect(
            planFunctionSettingChanges(current, {
                type: "FUNCTION",
                name: "Tick",
                description: "Runs every second",
            })
        ).toEqual([]);
        expect(
            planFunctionSettingChanges(
                { ...current, description: "Runs every second," },
                {
                    type: "FUNCTION",
                    name: "Tick",
                    description: "Runs every second,",
                }
            )
        ).toEqual([]);
        expect(
            planFunctionSettingChanges(
                { ...current, description: "Runs every second,." },
                {
                    type: "FUNCTION",
                    name: "Tick",
                    description: "Runs every second,",
                }
            )
        ).toContainEqual({
            key: "description",
            current: "Runs every second,.",
            desired: "Runs every second,",
        });
    });

    test("an explicit empty description resets an existing description", () => {
        expect(
            planFunctionSettingChanges(current, {
                type: "FUNCTION",
                name: "Tick",
                description: "",
            })
        ).toContainEqual({
            key: "description",
            current: "Runs every second.",
            desired: "",
        });
    });
});

test.each(["open settings", "write description"])(
    "%s retains the incomplete-read instance and appends the function context",
    async (step) => {
        const housing = await import("../src/importables/functions/housing");
        const lists = await import("../src/importables/functions/listFunctions");
        const menus = await import("../src/housingSync/menus/menuUtils");
        const { IncompleteReadError } = await import("../src/housingSync/incompleteRead");
        const { applyImportableFunctionPlan, functionApplicationPlan } =
            await import("../src/importables/functions/import");
        const { ApplicationProgress } =
            await import("../src/importables/import/applicationProgress");
        const failure = new IncompleteReadError("Settings menu not ready");
        vi.spyOn(lists, "openFunctionList").mockResolvedValue(undefined);
        vi.spyOn(housing, "readFunctionRepeatTicks").mockResolvedValue(0);
        const open = vi
            .spyOn(housing, "openFunctionSettings")
            .mockResolvedValue(undefined);
        if (step === "open settings") open.mockRejectedValue(failure);
        else vi.spyOn(menus, "setStringValue").mockRejectedValue(failure);
        const plan: import("../src/importables/functions/import").FunctionImportPlan = {
            kind: "FUNCTION",
            exists: true,
            importable: { type: "FUNCTION", name: "Readiness", actions: [] },
            actionsPlan: null,
            settingsPlan: [
                { key: "description", current: undefined, desired: "New description" },
            ],
        };
        const session = {} as import("../src/importables/import/context").ImportContext;
        await expect(
            applyImportableFunctionPlan(
                { getItemSlot: () => ({}) } as never,
                plan,
                session,
                new ApplicationProgress(functionApplicationPlan(plan, session), undefined)
            )
        ).rejects.toBe(failure);
        expect(failure.message).toBe(
            `HTSW_INCOMPLETE_READ: Settings menu not ready (${step === "open settings" ? "opening settings" : "setting description"} for function Readiness)`
        );
    }
);

afterEach(() => vi.restoreAllMocks());
