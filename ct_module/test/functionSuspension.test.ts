import { describe, expect, test, vi } from "vitest";
import TaskContext from "@htsw/importer/tasks/context";
import type { Action, ImportableFunction, ImportableItem } from "htsw/types";
import type { ObservedActionSlot } from "@htsw/importer/housingSync/observedActions";
import type { ImportContext } from "@htsw/importer/importables/import/context";
import { createKnownActionListPlan } from "@htsw/importer/housingSync/actions/plan";
import {
    baselineActionListFromActions,
    diffActionList,
} from "@htsw/importer/housingSync/actions/diff";
import {
    applyImportableFunctionPlan,
    functionApplicationPlan,
    type FunctionImportPlan,
    scanImportableFunction,
    hydrateImportableFunction,
    planImportableFunction,
} from "@htsw/importer/importables/functions/import";
import {
    planFunctionSettingChanges,
    type FunctionSettingChange,
} from "@htsw/importer/importables/functions/settings";
import { ApplicationProgress } from "@htsw/importer/importables/import/applicationProgress";
import { parseAutomaticExecutionTicks } from "@htsw/importer/importables/functions/housing";
import { changeVar, conditional, message } from "./utils";
import {
    buildTrustPlan,
    deleteImportableCache,
    readImportableCache,
    tryWriteImportableCache,
} from "@htsw/importer/importCache";
import type { ActionListPlan } from "@htsw/importer/housingSync/actions/plan";
import { createItemDiffContext } from "@htsw/importer/importables/items/diff";
import { createItemDependencyIndex } from "@htsw/importer/importables/items/dependencyIndex";
import { createProjectItemIndex } from "@htsw/importer/importables/items/projectItems";
import { itemFieldObservationFromSnbt } from "../src/housingSync/items/capture";
import type { ItemFieldObservationRecorder } from "@htsw/importer/housingSync/items/fieldObservations";

vi.mock("../src/utils/filesystem", async (original) => ({
    ...(await original<typeof import("../src/utils/filesystem")>()),
    atomicWriteText: () => true,
    getMtimeMs: () => 1,
}));

const live = vi.hoisted(() => ({ house: undefined as unknown as House }));
vi.mock("@htsw/importer/importables/functions/housing", async (original) => ({
    ...(await original<typeof import("@htsw/importer/importables/functions/housing")>()),
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
    readFunctionSettings: async () => ({
        repeatTicks: live.house.repeat,
        description: undefined,
        icon: undefined,
    }),
    openFunctionSettings: async () => {
        live.house.click("open settings");
    },
    readFunctionRepeatTicks: async () => {
        const h = live.house;
        h.click("read interval");
        h.intervalReads++;
        h.afterIntervalRead?.();
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
vi.mock("@htsw/importer/importables/functions/listFunctions", async (original) => ({
    ...(await original<typeof import("@htsw/importer/importables/functions/listFunctions")>()),
    getSessionFunctionNamesLower: async () =>
        new Set(live.house.exists ? ["autokick"] : []),
    openFunctionList: async () => {
        live.house.click("open functions");
    },
}));
vi.mock("@htsw/importer/housingSync/menus/menuUtils", async (original) => ({
    ...(await original<typeof import("@htsw/importer/housingSync/menus/menuUtils")>()),
    clickGoBack: async () => {
        live.house.click("back");
    },
}));
vi.mock("@htsw/importer/housingSync/actions/apply", async (original) => ({
    ...(await original<typeof import("@htsw/importer/housingSync/actions/apply")>()),
    applyActionListPlan: async (_ctx: unknown, plan: ActionListPlan) => {
        const h = live.house;
        h.bodyWrites++;
        if (h.applyAdds) {
            for (const op of plan.diff.operations) {
                if (op.kind !== "add") throw new Error("Expected only additions");
                h.body.splice(op.toIndex, 0, clone(op.desired));
                h.click("add action");
            }
            return;
        }
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
vi.mock("@htsw/importer/housingSync/actions/readList", async (original) => ({
    ...(await original<typeof import("@htsw/importer/housingSync/actions/readList")>()),
    scanActionList: async () => {
        const h = live.house;
        h.bodyReads++;
        h.click("scan whole body");
        const slots = clone(h.readBody ?? h.body).map(
            (action, index): ObservedActionSlot => ({
                index,
                action,
                hydrated: true,
                truncatedFields: [],
            })
        );
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
vi.mock("@htsw/importer/housingSync/actions/hydration/run", async (original) => ({
    ...(await original<typeof import("@htsw/importer/housingSync/actions/hydration/run")>()),
    hydrateActionListScan: async (
        _ctx: unknown,
        scan: {
            slots: ObservedActionSlot[];
            plan: Map<ObservedActionSlot, { childListsToRead: Set<string> }>;
        },
        read: { itemFieldObservations?: ItemFieldObservationRecorder }
    ) => {
        for (const slot of scan.slots) {
            if (slot.action?.type === "GIVE_ITEM" && live.house.itemSnbt !== null) {
                read.itemFieldObservations?.record(
                    slot.action as Action,
                    "itemName",
                    itemFieldObservationFromSnbt(live.house.itemSnbt)
                );
            }
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
        itemRead: { mode: "sync" },
        conflicts: [],
        conflictEvidence: [],
        canonicalizeItemName: (name: string) => name,
    },
    housingUuid: "function-suspension-house",
    ensuredReferencedShells: { functions: new Set<string>() },
    plannedReferencedShells: { functions: new Set<string>() },
} as unknown as ImportContext;

class House {
    exists = true;
    repeat = 5;
    body: Action[] = clone(old);
    target: Action[] = clone(target);
    readBody: Action[] | null = null;
    customItem?: ImportableItem;
    itemSnbt: string | null = null;
    initial: Action[] = clone(old);
    clicks = 0;
    cut = Infinity;
    cutLabel: string | null = null;
    applyAdds = false;
    intervalReads = 0;
    bodyWrites = 0;
    bodyReads = 0;
    writes: number[] = [];
    verified = false;
    rejectOff = false;
    unreadBody: "root" | "branch" | "mismatch" | null = null;
    context = new TaskContext();
    afterVerification?: () => void;
    afterIntervalRead?: () => void;

    assertSafe(): void {
        if (this.repeat > 0)
            expect(
                sameBody(clone(this.body), clone(this.initial)) ||
                    sameBody(clone(this.body), clone(this.target))
            ).toBe(true);
    }

    click(_label: string): void {
        this.assertSafe();
        this.context.checkCancelled();
        if (++this.clicks === this.cut || this.cutLabel === _label)
            throw new Error("disconnect");
    }
}

async function importHouse(
    house: House,
    repeatTicks = 5,
    trusted = false
): Promise<void> {
    live.house = house;
    session.actions.trust.trustMode = trusted;
    house.verified = false;
    const importable: ImportableFunction = {
        type: "FUNCTION",
        name: "Autokick",
        ...(repeatTicks > 0 ? { repeatTicks } : {}),
        actions: clone(house.target),
    };
    const importables = [importable, ...(house.customItem ? [house.customItem] : [])];
    const items = createProjectItemIndex(importables);
    session.actions.itemDiff = house.customItem
        ? createItemDiffContext(
              importables,
              createItemDependencyIndex(importables, items),
              items,
              session.housingUuid,
              () => undefined
          )
        : undefined;
    // Every retry plans from the live interval and body; nothing is journalled.
    let plan: FunctionImportPlan = {
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
    if (trusted) {
        const trust = buildTrustPlan(session.housingUuid, [importable], true);
        const read = await scanImportableFunction(
            {} as never,
            importable,
            session,
            trust.importables.get("FUNCTION:Autokick")
        );
        await hydrateImportableFunction({} as never, read);
        plan = planImportableFunction(read);
        house.verified = false;
    }
    const application = new ApplicationProgress(
        functionApplicationPlan(plan, session),
        {
            emit: () => {
                if (house.verified) house.afterVerification?.();
            },
        }
    );
    // Match the session's pre-apply invalidation; active creation must not
    // republish an empty cache after this point.
    if (trusted) deleteImportableCache(session.housingUuid, "FUNCTION", "Autokick");
    await applyImportableFunctionPlan(house.context, plan, session, application);
    await application.run("cache", async () => {
        if (trusted)
            await tryWriteImportableCache(
                {} as never,
                importable,
                "importer",
                session.housingUuid
            );
    });
    application.assertComplete();
}

describe("automatic function execution suspension", () => {
    test.each(["cancel", "force cancel"] as const)(
        "%s after body verification leaves repetition off",
        async (interruption) => {
            const h = new House();
            const click = vi.spyOn(h, "click");
            h.afterVerification = () => {
                click.mockClear();
                if (interruption === "cancel") h.context.cancel();
                else h.context.forceCancel();
            };
            await expect(importHouse(h)).rejects.toThrow("Task cancelled");
            expect(h.verified).toBe(true);
            expect(h.body).toEqual(h.target);
            expect(h.repeat).toBe(0);
            expect(h.writes).toEqual([0]);
            expect(click).not.toHaveBeenCalled();
        }
    );

    test("cancellation after successful enable read-back leaves repetition on", async () => {
        const h = new House();
        h.afterIntervalRead = () => {
            if (h.repeat === 5 && h.verified) h.context.cancel();
        };
        await expect(importHouse(h)).resolves.toBeUndefined();
        expect(h.context.isCancelled()).toBe(true);
        expect(h.verified).toBe(true);
        expect(h.body).toEqual(h.target);
        expect(h.repeat).toBe(5);
        expect(h.writes).toEqual([0, 5]);
        expect(h.intervalReads).toBe(3);
        expect(() => h.context.checkCancelled()).toThrow("Task cancelled");
    });

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

    test.each(["read interval", "add action"])(
        "trusted retry reads live state after interruption at %s in a new function",
        async (cutLabel) => {
            const h = new House();
            h.exists = false;
            h.repeat = 0;
            h.body = h.initial = [];
            h.target = [message("first"), message("second")];
            h.applyAdds = true;
            h.cutLabel = cutLabel;
            await expect(importHouse(h, 5, true)).rejects.toThrow("disconnect");
            expect(h.repeat).toBe(0);
            if (cutLabel === "add action") expect(h.body).toEqual([message("first")]);
            expect(
                readImportableCache(session.housingUuid, "FUNCTION", "Autokick")
            ).toBeNull();
            h.cutLabel = null;
            const reads = h.bodyReads;
            await importHouse(h, 5, true);
            // A missing cache forces a live scan before verification.
            expect(h.bodyReads - reads).toBe(2);
            expect(h.body).toEqual(h.target);
            expect(h.repeat).toBe(5);
            expect(
                readImportableCache(session.housingUuid, "FUNCTION", "Autokick")
                    ?.importable
            ).toEqual({
                type: "FUNCTION",
                name: "Autokick",
                repeatTicks: 5,
                actions: h.target,
            });
        }
    );

    test("an interval-only change suspends before a failing body read, then retries", async () => {
        const h = new House();
        h.target = clone(h.body);
        h.unreadBody = "mismatch";
        await expect(importHouse(h, 10)).rejects.toBeDefined();
        expect(h.repeat).toBe(0);
        expect(h.bodyWrites).toBe(0);
        expect(h.writes).toEqual([0]);
        h.unreadBody = null;
        await importHouse(h, 10);
        expect(h.repeat).toBe(10);
        expect(h.bodyWrites).toBe(0);
        expect(h.writes).toEqual([0, 10]);
    });

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

    test.each(["matching", "changed", "missing"] as const)(
        "repeating custom-item GIVE_ITEM verifies captured content (%s)",
        async (capture) => {
            const h = new House();
            h.body =
                h.target =
                h.initial =
                    [{ type: "GIVE_ITEM", itemName: "custom_stone" }];
            h.readBody = [{ type: "GIVE_ITEM", itemName: "Stone" }];
            h.customItem = {
                type: "ITEM",
                name: "custom_stone",
                nbt: {
                    type: "compound",
                    value: {
                        id: { type: "string", value: "minecraft:stone" },
                        Count: { type: "byte", value: 1 },
                        Damage: { type: "short", value: 0 },
                    },
                },
            };
            h.itemSnbt =
                capture === "missing"
                    ? null
                    : `{id:"minecraft:${capture === "matching" ? "stone" : "dirt"}",Count:1b,Damage:0s}`;
            if (capture === "matching") {
                await importHouse(h, 10);
                expect(h.repeat).toBe(10);
                expect(h.writes).toEqual([0, 10]);
            } else {
                await expect(importHouse(h, 10)).rejects.toThrow("did not verify");
                expect(h.repeat).toBe(0);
                expect(h.writes).toEqual([0]);
            }
        }
    );

    test("only explicitly readable interval values count as off", () => {
        expect(parseAutomaticExecutionTicks(["§7Current: §a0"])).toBe(0);
        expect(parseAutomaticExecutionTicks(["§7Current: §cDisabled"])).toBe(0);
        expect(parseAutomaticExecutionTicks(["§7Current: §a5"])).toBe(5);
        for (const lore of [[], ["Current: unknown"], ["Current: 0 or 5 ticks"]])
            expect(() => parseAutomaticExecutionTicks(lore)).toThrow();
    });
});
