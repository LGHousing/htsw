import { describe, expect, test } from "vitest";

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
