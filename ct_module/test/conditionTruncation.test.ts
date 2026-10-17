import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Condition } from "htsw/types";

const mocks = vi.hoisted(() => ({
    condition: {} as Condition,
    slot: { click: vi.fn(), getSlotId: () => 4 },
    back: vi.fn(async () => undefined),
    readGroup: vi.fn(async () => ({ type: "REQUIRE_GROUP" as const })),
}));
vi.mock("../src/housingSync/menus/paginatedList", () => ({
    getPaginatedListPageForIndex: () => 1,
    getPaginatedListSlotAtIndex: vi.fn(async () => mocks.slot),
    getVisiblePaginatedItemSlots: vi.fn(() => []),
    goToPaginatedListPage: vi.fn(async () => undefined),
    isEmptyPaginatedPlaceholder: vi.fn(() => false),
    readPaginatedList: vi.fn(async () => [
        {
            index: 0,
            slotId: 4,
            slot: mocks.slot,
            condition: mocks.condition,
        },
    ]),
}));
vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(async () => undefined),
}));
vi.mock("../src/housingSync/menus/menuUtils", async (original) => ({
    ...(await original<object>()),
    clickGoBack: mocks.back,
}));

vi.mock("../src/housingSync/actions/conditions/writers", async (original) => ({
    ...(await original<object>()),
    readRequireGroup: mocks.readGroup,
}));

import { readConditionList } from "../src/housingSync/actions/conditions/readList";
import { parseConditionListItem } from "../src/housingSync/fields/conditionMappings";
import { refreshTruncatedScalarFields } from "../src/housingSync/fields/readScalars";

function slot(lore: string[]) {
    return { getItem: () => ({ getLore: () => lore }) } as never;
}
function context(values: Partial<Record<string, string[]>>) {
    return {
        tryGetItemSlot: (label: string) =>
            values[label]
                ? slot(["§7Current Value:", ...values[label], "", "§eClick to edit!"])
                : null,
    } as never;
}
const options = {
    itemReadMode: "sync" as const,
    canonicalizeItemName: (name: string) => name,
};

beforeEach(() => vi.clearAllMocks());
describe("condition scalar truncation", () => {
    test("recovers the market Compare Value from raw editor lore and preserves metadata", async () => {
        mocks.condition = parseConditionListItem(
            slot([
                "§7Variable: §fabTask",
                "§7Comparator: §fEqual",
                '§7Compare Value: §f"&aTask: &7Sell items to get§7...',
                "§7Fallback Value: §fNot Set",
            ]),
            "COMPARE_VAR"
        );
        mocks.condition.note = "keep";
        mocks.condition.inverted = true;
        expect(mocks.condition).toMatchObject({
            amount: '"&aTask: &7Sell items to get&7...',
        });
        const result = await readConditionList(
            context({
                "Compare Value": ['§7§a"&aTask: &7Sell items to get 5g!"'],
            }),
            options
        );
        expect(result[0].condition).toMatchObject({
            type: "COMPARE_VAR",
            var: "abTask",
            amount: '"&aTask: &7Sell items to get 5g!"',
            note: "keep",
            inverted: true,
        });
        expect(result[0].condition).not.toHaveProperty("fallback");
        expect(mocks.slot.click).toHaveBeenCalledOnce();
    });

    test.each([
        "COMPARE_HEALTH",
        "COMPARE_MAX_HEALTH",
        "COMPARE_HUNGER",
        "COMPARE_DAMAGE",
        "COMPARE_PLACEHOLDER",
    ] as const)("hydrates %s without a registered reader", async (type) => {
        mocks.condition = { type, amount: "%some_long..." };
        const result = await readConditionList(
            context({ "Compare Value": ["§f%some_long_value%"] }),
            options
        );
        expect(result[0].condition).toMatchObject({ amount: "%some_long_value%" });
    });

    test("recovers team holders through their separate Team field", async () => {
        mocks.condition = {
            type: "COMPARE_VAR",
            holder: { type: "Team", team: "long..." },
        };
        const result = await readConditionList(
            context({ Team: ["§along team"] }),
            options
        );
        expect(result[0].condition).toMatchObject({
            holder: { type: "Team", team: "long team" },
        });
    });

    test.each([{}, { "Compare Value": [] }])(
        "rejects an unrecoverable read and returns to the list",
        async (values) => {
            mocks.condition = { type: "COMPARE_VAR", amount: "preview..." };
            await expect(
                readConditionList(
                    context(values as Partial<Record<string, string[]>>),
                    options
                )
            ).rejects.toThrow("COMPARE_VAR.amount");
            expect(mocks.condition.amount).toBe("preview...");
            expect(mocks.back).toHaveBeenCalledOnce();
        }
    );

    test("does not verify a truncated group dropped by its dedicated reader", async () => {
        mocks.condition = { type: "REQUIRE_GROUP", group: "long..." };
        await expect(readConditionList(context({}), options)).rejects.toThrow(
            "REQUIRE_GROUP.group"
        );
        expect(mocks.readGroup).toHaveBeenCalledOnce();
        expect(mocks.back).toHaveBeenCalledOnce();
    });

    test("preserves literal ellipses in authoritative editor values", () => {
        const action = { type: "MESSAGE", message: "Teleporting..." };
        refreshTruncatedScalarFields(
            context({ Message: ["§7§aTeleporting..."] }),
            action,
            [{ label: "Message", prop: "message", kind: "value" }]
        );
        expect(action.message).toBe("Teleporting...");
    });

    test("normalizes grouped numbers recovered from the editor", async () => {
        mocks.condition = { type: "COMPARE_VAR", amount: "1,234..." };
        const result = await readConditionList(
            context({ "Compare Value": ["§7§a1,234,567"] }),
            options
        );
        expect(result[0].condition).toMatchObject({ amount: "1234567" });
    });

    test("recovers named selections without display formatting", async () => {
        mocks.condition = { type: "REQUIRE_TEAM", team: "long..." };
        const result = await readConditionList(
            context({ "Required Team": ["§7§a§blong team"] }),
            options
        );
        expect(result[0].condition).toMatchObject({ team: "long team" });
    });

    test("does not open an editor for a complete preview", async () => {
        mocks.condition = { type: "COMPARE_VAR", amount: "5" };
        await readConditionList(context({}), options);
        expect(mocks.slot.click).not.toHaveBeenCalled();
    });

    test("shared action recovery rejects unavailable values too", () => {
        const action = { type: "CHANGE_VAR", amount: "preview..." };
        const fields = [{ label: "Amount", prop: "amount", kind: "value" as const }];
        expect(() => refreshTruncatedScalarFields(context({}), action, fields)).toThrow(
            "CHANGE_VAR.amount"
        );
        refreshTruncatedScalarFields(
            context({ Amount: ["§ffull", "§fvalue"] }),
            action,
            fields
        );
        expect(action.amount).toBe("full value");
    });
});
