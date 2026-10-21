import { describe, expect, test, vi } from "vitest";
import type { Action, ActionChangeVar } from "htsw/types";
import type TaskContext from "../src/tasks/context";
import type { ItemSlot } from "../src/tasks/specifics/slots";
import type { ActionSyncContext } from "../src/housingSync/actions/syncContext";
import { readActionListFully } from "../src/housingSync/actions/hydration/run";
import { readActionListPlan } from "../src/housingSync/actions/plan";
import { readActionListSync } from "../src/housingSync/actions/prepareSync";
import { readConditionList } from "../src/housingSync/actions/conditions/readList";

vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(async () => undefined),
    waitForMenu: vi.fn(async () => undefined),
}));

function slot(id: number, name: string, lore: string[] = [], click = () => {}) {
    return {
        getSlotId: () => id,
        getItem: () => ({ getName: () => name, getLore: () => lore }),
        click,
    } as unknown as ItemSlot;
}
const idAt = (index: number) => 10 + Math.floor((index % 21) / 7) * 9 + (index % 7);
const variableLore = (index: number) => [
    "Holder: Player",
    `Variable: v${index}`,
    "Operation: Set",
    `Value: ${index}`,
    "Automatic Unset: Disabled",
];
const variable = (index: number): ActionChangeVar => ({
    type: "CHANGE_VAR",
    holder: { type: "Player" },
    key: `v${index}`,
    op: "Set",
    value: String(index),
    unset: false,
});
type Menu = {
    title: string;
    entries: () => ItemSlot[];
    fields?: Record<string, ItemSlot>;
    pages?: number;
};

// Mirrors the paginated slots/editor stack in conflictReadCompleteness.test.ts.
function menus(root: Menu) {
    let current = root;
    let page = 1;
    const parents: Array<{ menu: Menu; page: number }> = [];
    const open = (menu: Menu) => {
        parents.push({ menu: current, page });
        current = menu;
        page = 1;
    };
    const controls = () => [
        ...(page > 1
            ? [
                  slot(45, "Previous Page", [], () => {
                      page--;
                  }),
              ]
            : []),
        ...(page < (current.pages ?? 1)
            ? [
                  slot(53, "Next Page", [], () => {
                      page++;
                  }),
              ]
            : []),
    ];
    const ctx = {
        getOpenContainerTitle: () =>
            page === 1 ? current.title : `(${page}/${current.pages}) ${current.title}`,
        getAllItemSlots: () => current.entries().slice((page - 1) * 21, page * 21),
        tryGetItemSlot: (matches: (item: ItemSlot) => boolean) =>
            controls().find(matches) ?? null,
        getItemSlot: (matches: (item: ItemSlot) => boolean) => controls().find(matches)!,
        tryGetMenuItemSlot: (label: string) =>
            label === "Go Back"
                ? slot(49, "Go Back", [], () => {
                      const parent = parents.pop()!;
                      current = parent.menu;
                      page = parent.page;
                  })
                : (current.fields?.[label] ?? null),
        getMenuItemSlot: (label: string): ItemSlot => {
            const found = ctx.tryGetMenuItemSlot(label);
            if (found === null) throw new Error(`Missing ${label}`);
            return found;
        },
    };
    return { ctx: ctx as unknown as TaskContext, open };
}
const options = {
    itemReadMode: "sync" as const,
    canonicalizeItemName: (name: string) => name,
};
function sync(): ActionSyncContext {
    return {
        canonicalizeItemName: options.canonicalizeItemName,
        itemRead: { mode: "sync" },
        overwriteWarningMode: "never",
        conflicts: [],
        conflictEvidence: [],
        trust: { trustMode: false, importables: new Map() },
    } as unknown as ActionSyncContext;
}
const readers = {
    export: (ctx: TaskContext, _desired: Action[]) => readActionListFully(ctx, options),
    plan: (ctx: TaskContext, desired: Action[]) =>
        readActionListPlan(ctx, desired, { sync: sync() }),
    sync: (ctx: TaskContext, desired: Action[]) =>
        readActionListSync(ctx, { desired, basePath: "actions", sync: sync() }),
};

describe.each(Object.entries(readers))("%s rejects incomplete reads", (_name, read) => {
    test.each([0, 20, 21, 24])(
        "rejects Head at action %i, including the final page",
        async (index) => {
            const ui = menus({
                title: "Edit Actions",
                pages: 2,
                entries: () =>
                    Array.from({ length: 25 }, (_, i) =>
                        slot(
                            idAt(i),
                            i === index ? "Head" : "Change Variable",
                            variableLore(i)
                        )
                    ),
            });
            await expect(
                read(
                    ui.ctx,
                    Array.from({ length: 25 }, (_, i) => variable(i))
                )
            ).rejects.toThrow(
                /^HTSW_INCOMPLETE_READ: Incomplete action list.*Head.*slot/
            );
        }
    );
    test.each(["Variable", "Operation", "Value", "Holder", "Automatic Unset", "all"])(
        "rejects missing %s lore",
        async (label) => {
            const lore =
                label === "all"
                    ? []
                    : variableLore(0).filter((line) => !line.startsWith(label + ":"));
            const ui = menus({
                title: "Edit Actions",
                entries: () => [slot(10, "Change Variable", lore)],
            });
            await expect(read(ui.ctx, [variable(0)])).rejects.toThrow(
                /^HTSW_INCOMPLETE_READ: Incomplete CHANGE_VAR.*lore/
            );
        }
    );
    test("rejects a short nonfinal page", async () => {
        const ui = menus({
            title: "Edit Actions",
            pages: 2,
            entries: () => [slot(10, "Kill Player")],
        });
        await expect(read(ui.ctx, [{ type: "KILL" }])).rejects.toThrow(
            "HTSW_INCOMPLETE_READ: Incomplete paginated action list"
        );
    });
});

test.each(["Head", "Variable Requirement"])(
    "rejects an unreadable %s condition",
    async (name) => {
        const ui = menus({ title: "Edit Conditions", entries: () => [slot(10, name)] });
        await expect(readConditionList(ui.ctx, options)).rejects.toThrow(
            /^HTSW_INCOMPLETE_READ: Incomplete/
        );
    }
);

test("rejects a mixed empty placeholder rather than discarding it", async () => {
    const ui = menus({
        title: "Edit Actions",
        entries: () => [slot(10, "No Actions!"), slot(11, "Kill Player")],
    });
    await expect(readActionListFully(ui.ctx, options)).rejects.toThrow(
        "HTSW_INCOMPLETE_READ: Incomplete action list: empty-list placeholder mixed with entries"
    );
});

function conditionalMenu(
    change: "none" | "Head" | "short final page" | "condition Head"
) {
    const roots: ItemSlot[] = [];
    const ui = menus({ title: "Actions: F004", pages: 2, entries: () => roots });
    const expected: Action[] = [];
    for (let c = 0; c < 25; c++) {
        const branch = (offset: number): Menu => ({
            title: "Edit Actions",
            pages: 2,
            entries: () =>
                Array.from(
                    {
                        length:
                            change === "short final page" && c === 2 && offset === 0
                                ? 24
                                : 25,
                    },
                    (_, i) =>
                        slot(
                            idAt(i),
                            change === "Head" && c === 2 && offset === 0 && i === 24
                                ? "Head"
                                : "Change Variable",
                            variableLore(c * 50 + offset + i)
                        )
                ),
        });
        const conditions: Menu = {
            title: "Edit Conditions",
            entries: () => [
                slot(
                    10,
                    change === "condition Head" && c === 2
                        ? "Head"
                        : "Variable Requirement",
                    [
                        "Holder: Player",
                        "Variable: ph",
                        "Comparator: Equal",
                        "Compare Value: 0",
                        "Fallback Value: Not Set",
                    ]
                ),
            ],
        };
        const editor: Menu = {
            title: "Action Settings",
            entries: () => [],
            fields: {
                Conditions: slot(10, "Conditions", [], () => ui.open(conditions)),
                "Match Any Condition": slot(11, "Match Any Condition", [
                    "Current Value:",
                    "Disabled",
                ]),
                "If Actions": slot(12, "If Actions", [], () => ui.open(branch(0))),
                "Else Actions": slot(13, "Else Actions", [], () => ui.open(branch(25))),
            },
        };
        roots.push(
            slot(
                idAt(c),
                "Conditional",
                [
                    "Match Any Condition: Disabled",
                    "Conditions:",
                    "- Variable Requirement",
                    "",
                    "If Actions:",
                    ...Array<string>(25).fill("- Change Variable"),
                    "",
                    "Else Actions:",
                    ...Array<string>(25).fill("- Change Variable"),
                    "",
                ],
                () => ui.open(editor)
            )
        );
        expected.push({
            type: "CONDITIONAL",
            matchAny: false,
            conditions: [
                {
                    type: "COMPARE_VAR",
                    holder: { type: "Player" },
                    var: "ph",
                    op: "Equal",
                    amount: "0",
                },
            ],
            ifActions: Array.from({ length: 25 }, (_, i) => variable(c * 50 + i)),
            elseActions: Array.from({ length: 25 }, (_, i) => variable(c * 50 + 25 + i)),
        });
    }
    return { ...ui, expected };
}

test("reads all 25 conditionals and 1,250 branch actions with no omissions", async () => {
    const ui = conditionalMenu("none");
    await expect(readActionListFully(ui.ctx, options)).resolves.toEqual(ui.expected);
});
for (const [name, read] of Object.entries(readers)) {
    test.each(["Head", "short final page", "condition Head"] as const)(
        `${name} stops on nested %s`,
        async (change) => {
            const ui = conditionalMenu(change);
            await expect(read(ui.ctx, ui.expected)).rejects.toThrow(
                /^HTSW_INCOMPLETE_READ: Incomplete/
            );
        }
    );
}

test.each(["actions", "conditions"])(
    "empty %s menus retain the retry marker",
    async (kind) => {
        const ui = menus({ title: `Edit ${kind}`, entries: () => [] });
        await expect(
            kind === "actions"
                ? readActionListFully(ui.ctx, options)
                : readConditionList(ui.ctx, options)
        ).rejects.toThrow(
            /^HTSW_INCOMPLETE_READ: .*no entries or empty-list placeholder/
        );
    }
);
