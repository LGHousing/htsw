import { describe, expect, test, vi } from "vitest";
import type { Action, ActionConditional, ActionRandom } from "htsw/types";

const mocks = vi.hoisted(() => ({
    clickGoBack: vi.fn(async () => undefined),
    setBooleanValue: vi.fn(async () => undefined),
    waitForMenu: vi.fn(async () => undefined),
}));

vi.mock("../src/housingSync/menus/menuUtils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/housingSync/menus/menuUtils")>()),
    clickGoBack: mocks.clickGoBack,
    setBooleanValue: mocks.setBooleanValue,
}));

vi.mock("../src/housingSync/menus/menuWait", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/housingSync/menus/menuWait")>()),
    waitForMenu: mocks.waitForMenu,
}));

import { writeConditional, writeRandom } from "../src/housingSync/actions/writers";

const child: Action = { type: "MESSAGE", message: "same structure" };
const ctx = {
    getMenuItemSlot: vi.fn(() => ({ click: vi.fn() })),
};

function applyOnly(propToApply: string) {
    return {
        markHeaderApplied: vi.fn(),
        shouldApplyList: vi.fn((prop: string) => prop === propToApply),
        applyChildActions: vi.fn(async () => undefined),
        applyConditions: vi.fn(async () => undefined),
    };
}

describe("item-aware child-list writes", () => {
    test("applies an item-only change in an otherwise equal conditional list", async () => {
        const action: ActionConditional = {
            type: "CONDITIONAL",
            conditions: [],
            matchAny: false,
            ifActions: [child],
            elseActions: [],
        };
        const apply = applyOnly("ifActions");

        await writeConditional(ctx as never, action, {
            current: action,
            resolveItem: vi.fn(async () => {
                throw new Error("unused");
            }),
            apply,
        });

        expect(apply.applyChildActions).toHaveBeenCalledWith("ifActions", {
            desired: action.ifActions,
            observed: action.ifActions,
        });
    });

    test("applies an item-only change in an otherwise equal random list", async () => {
        const action: ActionRandom = { type: "RANDOM", actions: [child] };
        const apply = applyOnly("actions");

        await writeRandom(ctx as never, action, {
            current: action,
            resolveItem: vi.fn(async () => {
                throw new Error("unused");
            }),
            apply,
        });

        expect(apply.applyChildActions).toHaveBeenCalledWith("actions", {
            desired: action.actions,
            observed: action.actions,
        });
    });
});
