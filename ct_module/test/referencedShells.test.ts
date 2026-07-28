import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Action, Importable } from "htsw/types";

const mocks = vi.hoisted(() => ({
    ensureFunctions: vi.fn(async () => undefined),
    ensureMenus: vi.fn(async () => undefined),
    ensureRegions: vi.fn(async () => undefined),
}));

vi.mock("../src/importables/functions/housing", () => ({
    ensureFunctionNamesExist: mocks.ensureFunctions,
}));
vi.mock("../src/importables/menus/housing", () => ({
    ensureMenuNamesExist: mocks.ensureMenus,
}));
vi.mock("../src/importables/regions/housing", () => ({
    ensureRegionNamesExist: mocks.ensureRegions,
}));
vi.mock("../src/importables/functions/listFunctions", () => ({
    getSessionFunctionNamesLower: async () => new Set<string>(),
}));
vi.mock("../src/importables/menus/listMenus", () => ({
    getSessionMenuNamesLower: async () => new Set<string>(),
}));
vi.mock("../src/importables/regions/listRegions", () => ({
    listAllRegionNames: async () => [],
}));

import {
    applyReferencedShellPlan,
    planMissingReferencedShells,
} from "../src/importables/import/references";

function fn(name: string, actions: Action[]): Importable {
    return { type: "FUNCTION", name, actions } as unknown as Importable;
}

describe("referenced shell planning", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("dedupes missing Housing names across importables case-insensitively", async () => {
        const plan = await planMissingReferencedShells({} as never, [
            fn("a", [{ type: "FUNCTION", function: "Shared" }] as unknown as Action[]),
            fn("b", [{ type: "FUNCTION", function: "shared" }] as unknown as Action[]),
        ]);

        expect(plan.functions).toEqual(["Shared"]);
    });

    test("resolves every planned shell even when it appeared before apply", async () => {
        const resolved: Array<[string, string, boolean]> = [];

        await applyReferencedShellPlan(
            {} as never,
            { functions: ["Late"], menus: [], regions: [] },
            (kind, name, created) => {
                resolved.push([kind, name, created]);
            }
        );

        expect(resolved).toEqual([["function", "Late", false]]);
    });
});
