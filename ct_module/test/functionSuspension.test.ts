import { describe, expect, test, vi } from "vitest";
import type { Action, ImportableFunction } from "htsw/types";
import type { ObservedActionSlot } from "../src/housingSync/observedActions";
import type { ImportContext } from "../src/importables/import/context";
import { createKnownActionListPlan } from "../src/housingSync/actions/plan";
import {
    baselineActionListFromActions,
    diffActionList,
} from "../src/housingSync/actions/diff";
import {
    applyImportableFunctionPlan,
    functionApplicationPlan,
    type FunctionImportPlan,
} from "../src/importables/functions/import";
import {
    planFunctionSettingChanges,
    type FunctionSettingChange,
} from "../src/importables/functions/settings";
import { ApplicationProgress } from "../src/importables/import/applicationProgress";
import { parseAutomaticExecutionTicks } from "../src/importables/functions/housing";
import { changeVar, conditional, message } from "./utils";

const live = vi.hoisted(() => ({ house: undefined as unknown as House }));
vi.mock("../src/importables/functions/housing", async (original) => ({
    ...(await original<typeof import("../src/importables/functions/housing")>()),
    ensureFunctionExists: async () => {
        live.house.click("open function");
        if (!live.house.exists) {
            live.house.exists = true;
            live.house.repeat = 0;
            live.house.body = [];
            live.house.click("create function with repeat off");
        }
    },
    openFunctionEditor: async () => {
        live.house.click("open body read-back");
        return "opened";
    },
    openFunctionSettings: async () => {
        live.house.click("open settings");
    },
    readFunctionRepeatTicks: async () => {
        const h = live.house;
        h.click("read interval");
        h.intervalReads++;
        return h.repeat;
    },
    applyFunctionSettings: async (
        _ctx: unknown,
        _fn: unknown,
        changes: FunctionSettingChange[]
    ) => {
        const h = live.house;
        for (const change of changes) {
            h.click("open value prompt");
            if (change.key !== "repeatTicks")
                throw new Error("Unexpected metadata write");
            const target = change.desired ?? 0;
            if (target > 0) expect(h.verified).toBe(true);
            if (!h.rejectOff || target !== 0) h.repeat = target;
            h.writes.push(target);
            h.click("submit repeat interval");
        }
    },
}));
vi.mock("../src/importables/functions/listFunctions", async (original) => ({
    ...(await original<typeof import("../src/importables/functions/listFunctions")>()),
    openFunctionList: async () => {
        live.house.click("open functions");
    },
}));
vi.mock("../src/importables/import/emptyShells", () => ({
    recordEmptyFunctionShell: async () => undefined,
}));
vi.mock("../src/housingSync/menus/menuUtils", async (original) => ({
    ...(await original<typeof import("../src/housingSync/menus/menuUtils")>()),
    clickGoBack: async () => {
        live.house.click("back");
    },
}));
vi.mock("../src/housingSync/actions/apply", async (original) => ({
    ...(await original<typeof import("../src/housingSync/actions/apply")>()),
    applyActionListPlan: async () => {
        const h = live.house;
        h.bodyWrites++;
        const first = h.body.length > 0 ? h.body[0] : undefined;
        if (first?.type === "CONDITIONAL") {
            // The recorded Autokick edit: open the old Conditional/Conditions,
            // remove its only Required Group guard, then replace its contents.
            h.click("09:43:11.857 open Conditional");
            h.click("09:43:12.254 open Conditions");
            first.conditions = [];
            h.click("09:43:12.657 remove sole Required Group");
            first.conditions = clone(
                (h.target[0] as Extract<Action, { type: "CONDITIONAL" }>).conditions
            );
            h.click("add target conditions");
            first.ifActions = [];
            h.click("remove old WIP/lobby body");
        }
        // Arbitrary sibling changes are allowed while repeat is off. This
        // deliberately creates dangerous partial states instead of relying on
        // any per-conditional edit order for safety.
        h.body = [];
        h.click("clear old body");
        for (const action of h.target) {
            h.body.push(clone(action));
            h.click("add action");
        }
    },
}));
vi.mock("../src/housingSync/actions/readList", async (original) => ({
    ...(await original<typeof import("../src/housingSync/actions/readList")>()),
    scanActionList: async () => {
        const h = live.house;
        h.click("scan whole body");
        const slots = clone(h.body).map((action, index): ObservedActionSlot => ({
            index,
            action,
            hydrated: true,
            truncatedFields: [],
        }));
        if (h.unreadBody === "root")
            slots.push({
                index: slots.length,
                action: null,
                hydrated: false,
                truncatedFields: [],
            });
        if (h.unreadBody === "branch" && slots[0]?.action?.type === "CONDITIONAL")
            slots[0].action.ifActions?.push(null);
        if (h.unreadBody === "mismatch")
            slots.push({
                index: slots.length,
                action: message("unexpected"),
                hydrated: true,
                truncatedFields: [],
            });
        return { slots, plan: new Map() };
    },
}));
vi.mock("../src/housingSync/actions/hydration/run", async (original) => ({
    ...(await original<typeof import("../src/housingSync/actions/hydration/run")>()),
    hydrateActionListScan: async (
        _ctx: unknown,
        scan: {
            slots: ObservedActionSlot[];
            plan: Map<ObservedActionSlot, { childListsToRead: Set<string> }>;
        }
    ) => {
        for (const slot of scan.slots) {
            if (slot.action?.type === "CONDITIONAL")
                expect([...scan.plan.get(slot)!.childListsToRead]).toEqual([
                    "conditions",
                    "ifActions",
                    "elseActions",
                ]);
        }
        live.house.click("read all branch entries");
        live.house.verified = !live.house.unreadBody;
    },
}));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sameBody = (a: Action[], b: Action[]): boolean =>
    diffActionList(baselineActionListFromActions(a), b).operations.length === 0;
const old = [
    conditional({
        conditions: [
            {
                type: "REQUIRE_GROUP",
                group: "Resident",
                includeHigherGroups: true,
                inverted: true,
            },
        ],
        ifActions: [message("&cWIP!"), { type: "SEND_TO_LOBBY", lobby: "Housing" }],
    }),
];
const target = [
    conditional({
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
    }),
];
const session = {
    actions: {
        trust: { trustMode: false },
        canonicalizeItemName: (name: string) => name,
    },
    ensuredReferencedShells: { functions: new Set<string>() },
    plannedReferencedShells: { functions: new Set<string>() },
} as unknown as ImportContext;

class House {
    exists = true;
    repeat = 5;
    body: Action[] = clone(old);
    target: Action[] = clone(target);
    initial: Action[] = clone(old);
    clicks = 0;
    cut = Infinity;
    intervalReads = 0;
    bodyWrites = 0;
    writes: number[] = [];
    verified = false;
    rejectOff = false;
    unreadBody: "root" | "branch" | "mismatch" | null = null;

    assertSafe(): void {
        if (this.repeat > 0)
            expect(
                sameBody(clone(this.body), clone(this.initial)) ||
                    sameBody(clone(this.body), clone(this.target))
            ).toBe(true);
    }

    click(_label: string): void {
        this.assertSafe();
        if (++this.clicks === this.cut) throw new Error("disconnect");
    }
}

async function importHouse(house: House, repeatTicks = 5): Promise<void> {
    live.house = house;
    house.verified = false;
    const importable: ImportableFunction = {
        type: "FUNCTION",
        name: "Autokick",
        ...(repeatTicks > 0 ? { repeatTicks } : {}),
        actions: clone(house.target),
    };
    // Every retry plans from the live interval and body; nothing is journalled.
    const plan: FunctionImportPlan = {
        kind: "FUNCTION",
        exists: house.exists,
        importable,
        actionsPlan: createKnownActionListPlan(importable.actions!, clone(house.body), {
            sync: session.actions,
        }),
        settingsPlan: planFunctionSettingChanges(
            { repeatTicks: house.repeat, description: undefined, icon: undefined },
            importable
        ),
    };
    const application = new ApplicationProgress(
        functionApplicationPlan(plan, session),
        undefined
    );
    await applyImportableFunctionPlan({} as never, plan, session, application);
    await application.run("cache", async () => undefined);
    application.assertComplete();
}

describe("automatic function execution suspension", () => {
    test.each(["Autokick", "new function", "Exit sibling", "variable ordering"])(
        "disconnect at every modelled GUI click, then fresh import converges (%s)",
        async (scenario) => {
            const isNew = scenario === "new function";
            const setup = (): House => {
                const h = new House();
                if (isNew) {
                    h.exists = false;
                    h.body = [];
                    h.initial = [];
                    h.repeat = 0;
                }
                if (scenario === "Exit sibling") {
                    h.body = [
                        conditional({
                            conditions: [{ type: "IS_SNEAKING" }],
                            ifActions: [{ type: "EXIT" }],
                        }),
                        { type: "SEND_TO_LOBBY" },
                    ];
                    h.target = [
                        conditional({
                            conditions: [{ type: "IS_SNEAKING" }, { type: "IS_FLYING" }],
                            ifActions: [{ type: "EXIT" }],
                        }),
                        { type: "SEND_TO_LOBBY" },
                    ];
                    h.initial = clone(h.body);
                }
                if (scenario === "variable ordering") {
                    const x0 = changeVar({ key: "x", value: "0" });
                    const x1 = changeVar({ key: "x", value: "1" });
                    const guard = (amount: string) =>
                        conditional({
                            conditions: [
                                {
                                    type: "COMPARE_VAR",
                                    holder: { type: "Player" },
                                    var: "x",
                                    op: "Equal",
                                    amount,
                                },
                            ],
                            ifActions: [{ type: "SEND_TO_LOBBY" }],
                        });
                    h.body = [x0, guard("1"), x1];
                    h.target = [clone(x0), clone(x1), guard("0")];
                    h.initial = clone(h.body);
                }
                return h;
            };
            const complete = setup();
            await importHouse(complete);
            expect(complete.repeat).toBe(5);
            expect(complete.body).toEqual(complete.target);
            expect(complete.writes).toEqual(isNew ? [5] : [0, 5]);
            for (let cut = 1; cut <= complete.clicks; cut++) {
                const h = setup();
                h.cut = cut;
                await expect(importHouse(h)).rejects.toThrow("disconnect");
                for (let repeat = 0; repeat < 20; repeat++) h.assertSafe();
                if (
                    !sameBody(clone(h.body), clone(h.initial)) &&
                    !sameBody(clone(h.body), clone(h.target))
                )
                    expect(h.repeat).toBe(0);
                h.cut = Infinity;
                await importHouse(h);
                expect(h.repeat).toBe(5);
                expect(h.body).toEqual(h.target);
            }
        }
    );

    test("unchanged repeating functions have no interval reads, writes or extra clicks", async () => {
        const h = new House();
        h.target = clone(h.body);
        await importHouse(h);
        expect(h.clicks).toBe(0);
        expect(h.intervalReads).toBe(0);
        expect(h.writes).toEqual([]);
    });

    test("non-repeating functions edit normally without interval writes", async () => {
        const h = new House();
        h.repeat = 0;
        await importHouse(h, 0);
        expect(h.bodyWrites).toBe(1);
        expect(h.verified).toBe(false);
        expect(h.writes).toEqual([]);
    });

    test("off must verify before touching the body; unread whole bodies cannot be enabled", async () => {
        const h = new House();
        h.rejectOff = true;
        await expect(importHouse(h)).rejects.toBeDefined();
        expect(h.bodyWrites).toBe(0);
        expect(h.body).toEqual(old);
        h.rejectOff = false;
        h.unreadBody = "root";
        await expect(importHouse(h)).rejects.toThrow("no parsed action");
        expect(h.repeat).toBe(0);
        h.unreadBody = "branch";
        await expect(importHouse(h)).rejects.toThrow("unread entry");
        expect(h.repeat).toBe(0);
        h.unreadBody = "mismatch";
        await expect(importHouse(h)).rejects.toBeDefined();
        expect(h.repeat).toBe(0);
        h.unreadBody = null;
        await importHouse(h);
        expect(h.repeat).toBe(5);
        expect(h.body).toEqual(target);
    });

    test("equivalent condition order verifies before enabling execution", async () => {
        const h = new House();
        h.target = [
            conditional({
                conditions: [{ type: "IS_SNEAKING" }, { type: "IS_FLYING" }],
                ifActions: [message("guarded")],
            }),
        ];
        h.body = [
            conditional({
                ...(h.target[0] as Extract<Action, { type: "CONDITIONAL" }>),
                conditions: [{ type: "IS_FLYING" }, { type: "IS_SNEAKING" }],
            }),
        ];
        h.initial = clone(h.body);
        h.repeat = 0;
        await importHouse(h);
        expect(h.bodyWrites).toBe(0);
        expect(h.writes).toEqual([5]);
        expect(h.verified).toBe(true);
    });

    test("only explicitly readable interval values count as off", () => {
        expect(parseAutomaticExecutionTicks(["§7Current: §a0"])).toBe(0);
        expect(parseAutomaticExecutionTicks(["§7Current: §cDisabled"])).toBe(0);
        expect(parseAutomaticExecutionTicks(["§7Current: §a5"])).toBe(5);
        for (const lore of [[], ["Current: unknown"], ["Current: 5garbage"]])
            expect(() => parseAutomaticExecutionTicks(lore)).toThrow();
    });
});
