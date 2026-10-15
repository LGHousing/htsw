import { describe, expect, test, vi } from "vitest";
import type { Action, ActionConditional, ActionRandom } from "htsw/types";

const mocks = vi.hoisted(() => ({
    clickGoBack: vi.fn(async () => undefined),
    setBooleanValue: vi.fn(async () => undefined),
    waitForMenu: vi.fn(async () => undefined),
    readBooleanValue: vi.fn((): boolean | null => false),
}));

vi.mock("../src/housingSync/menus/menuUtils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/housingSync/menus/menuUtils")>()),
    clickGoBack: mocks.clickGoBack,
    setBooleanValue: mocks.setBooleanValue,
    readBooleanValue: mocks.readBooleanValue,
}));

vi.mock("../src/housingSync/menus/menuWait", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/housingSync/menus/menuWait")>()),
    waitForMenu: mocks.waitForMenu,
}));

import { writeConditional, writeRandom } from "../src/housingSync/actions/writers";
import { readOpenConditional } from "../src/housingSync/actions/readers";

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
    test("an unreadable Match Any setting cannot verify as disabled", async () => {
        mocks.readBooleanValue.mockReturnValueOnce(null);
        await expect(
            readOpenConditional({
                ctx: ctx as never,
                childListsToRead: new Set(),
            })
        ).rejects.toThrow("Could not read the conditional's Match Any setting");
    });
    test.each([false, true])(
        "preserves live guards before any write (matchAny=%s)",
        async (matchAny) => {
            const current: ActionConditional = {
                type: "CONDITIONAL",
                matchAny,
                conditions: [
                    {
                        type: "REQUIRE_GROUP",
                        group: "Resident",
                        includeHigherGroups: true,
                        inverted: true,
                    },
                ],
                ifActions: [
                    { type: "MESSAGE", message: "&cWIP!" },
                    { type: "SEND_TO_LOBBY", lobby: "Housing" },
                ],
                elseActions: [],
            };
            const desired: ActionConditional = {
                ...current,
                // The cheapest edit pairs the old kick block with the pending-Boom
                // block, not necessarily the new admission check (#179).
                conditions: [
                    {
                        type: "COMPARE_VAR",
                        holder: { type: "Global" },
                        var: "bqc",
                        op: "Greater Than",
                        amount: "0",
                        fallback: "0",
                    },
                ],
                ifActions: [{ type: "FUNCTION", function: "Boom Check", global: false }],
            };
            const apply = applyOnly("conditions");
            ctx.getMenuItemSlot.mockClear();
            await expect(
                writeConditional(ctx as never, desired, {
                    current,
                    resolveItem: vi.fn(),
                    apply,
                })
            ).rejects.toBeDefined();
            expect(ctx.getMenuItemSlot).not.toHaveBeenCalled();
            expect(apply.applyConditions).not.toHaveBeenCalled();
        }
    );

    test("a condition note does not rewrite its predicate above populated branches", async () => {
        const current: ActionConditional = {
            type: "CONDITIONAL",
            matchAny: false,
            conditions: [{ type: "IS_SNEAKING", note: "old" }],
            ifActions: [child],
            elseActions: [],
        };
        const apply = applyOnly("conditions");
        await writeConditional(
            ctx as never,
            { ...current, conditions: [{ type: "IS_SNEAKING", note: "new" }] },
            {
                current,
                resolveItem: vi.fn(),
                apply,
            }
        );
        expect(apply.applyConditions).toHaveBeenCalled();
    });

    test("unknown branch contents cannot be treated as empty", async () => {
        const desired: ActionConditional = {
            type: "CONDITIONAL",
            matchAny: false,
            conditions: [{ type: "IS_SNEAKING" }],
            ifActions: [],
            elseActions: [],
        };
        ctx.getMenuItemSlot.mockClear();
        await expect(
            writeConditional(ctx as never, desired, {
                current: { type: "CONDITIONAL", matchAny: false },
                resolveItem: vi.fn(),
                apply: applyOnly("conditions"),
            })
        ).rejects.toBeDefined();
        expect(ctx.getMenuItemSlot).not.toHaveBeenCalled();
    });

    test("refuses a mode change protecting an else branch before writes", async () => {
        const current: ActionConditional = {
            type: "CONDITIONAL",
            matchAny: false,
            conditions: [{ type: "IS_SNEAKING" }],
            ifActions: [],
            elseActions: [child],
        };
        ctx.getMenuItemSlot.mockClear();
        await expect(
            writeConditional(
                ctx as never,
                { ...current, matchAny: true },
                {
                    current,
                    resolveItem: vi.fn(),
                    apply: applyOnly("none"),
                }
            )
        ).rejects.toBeDefined();
        expect(ctx.getMenuItemSlot).not.toHaveBeenCalled();
    });

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
