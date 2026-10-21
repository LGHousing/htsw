import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Action, ImportableMenu } from "htsw/types";
import type { ActionListApplyResult } from "@htsw/importer/housingSync/actions/apply";
import type { ActionSyncContext } from "@htsw/importer/housingSync/actions/syncContext";
import type { ImportContext } from "@htsw/importer/importables/import/context";
import {
    applyImportableMenuPlan,
    menuApplicationPlan,
    planImportableMenu,
    reconstructPartialMenu,
    type MenuImportPlan,
} from "@htsw/importer/importables/menus/import";
import {
    type ActionListPlan,
    createKnownActionListPlan,
    readActionListPlan,
} from "@htsw/importer/housingSync/actions/plan";
import { actionListApplyResultFromError } from "@htsw/importer/housingSync/actions/apply";
import { ApplicationProgress } from "@htsw/importer/importables/import/applicationProgress";
import { writeImportableCache, readImportableCache } from "@htsw/importer/importCache/cache";
import { upsertHouseLockImportable, readHouseLock } from "@htsw/importer/importCache/houseLock";
import { houseLockCurrentEntryFor } from "@htsw/importer/importCache/acceptHouseLock";
import { buildCacheStatusRow } from "@htsw/importer/importCache/status";
import { buildTrustPlan } from "@htsw/importer/importCache/trust";
import { scanActionListSync } from "@htsw/importer/housingSync/actions/prepareSync";
import { menuSlotActionsPath } from "@htsw/importer/importCache/actionLists";
import { message, observedSlot } from "./utils";

const mocks = vi.hoisted(() => ({
    apply: vi.fn(),
    scan: vi.fn(),
    save: vi.fn(),
    resize: vi.fn(),
    select: vi.fn(),
}));
vi.mock("@htsw/importer/housingSync/actions/apply", async (original) => ({
    ...(await original<typeof import("@htsw/importer/housingSync/actions/apply")>()),
    applyActionListPlan: mocks.apply,
}));
vi.mock("@htsw/importer/housingSync/actions/readList", async (original) => ({
    ...(await original<typeof import("@htsw/importer/housingSync/actions/readList")>()),
    scanActionList: mocks.scan,
}));
vi.mock("@htsw/importer/housingSync/actions/hydration/run", async (original) => ({
    ...(await original<typeof import("@htsw/importer/housingSync/actions/hydration/run")>()),
    hydrateActionListScan: vi.fn(async () => undefined),
}));
vi.mock("@htsw/importer/importables/menus/housing", () => ({
    openMenuEditor: vi.fn(async () => "opened"),
    openMenuElements: vi.fn(async () => undefined),
    setMenuSize: mocks.resize,
}));
vi.mock("../src/housingSync/items/itemPicker", () => ({
    selectItemFromOpenInventory: mocks.select,
}));
vi.mock("@htsw/importer/housingSync/menus/menuUtils", async (original) => ({
    ...(await original<typeof import("@htsw/importer/housingSync/menus/menuUtils")>()),
    clickGoBack: vi.fn(async () => undefined),
}));
vi.mock("@htsw/importer/housingSync/menus/menuWait", async (original) => ({
    ...(await original<typeof import("@htsw/importer/housingSync/menus/menuWait")>()),
    timedWaitForMenu: vi.fn(async () => undefined),
}));
vi.mock("../src/utils/nbt", async (original) => ({
    ...(await original<typeof import("../src/utils/nbt")>()),
    getItemFromNbt: () => ({ getName: () => "Stone" }),
    getItemFromSnbt: () => ({ getName: () => "Stone" }),
}));
vi.mock("@htsw/importer/housingSync/items/itemNbt", async (original) => ({
    ...(await original<typeof import("@htsw/importer/housingSync/items/itemNbt")>()),
    canonicalItemShellKey: () => "stone",
}));
vi.mock("../src/utils/filesystem", () => ({
    atomicWriteText: mocks.save,
    getMtimeMs: () => 1,
}));

let files: Partial<Record<string, string>>;
let counter = 0;
let house: string;
const source = "./project/import.json";
const ctx = { displayMessage: vi.fn() };
beforeEach(() => {
    vi.clearAllMocks();
    files = {};
    house = `menu-partial-${++counter}`;
    vi.stubGlobal("FileLib", {
        exists: (path: string) => files[path] !== undefined,
        read: (path: string) => files[path] ?? null,
    });
    vi.stubGlobal("Player", { getContainer: () => ({ click: vi.fn() }) });
    mocks.save.mockImplementation((path: string, text: string) => {
        files[path] = text;
        return true;
    });
    mocks.apply.mockImplementation(async (_ctx: unknown, plan: ActionListPlan) => ({
        currentSnapshot: plan.desired,
        mutationStarted: true,
    }));
    mocks.scan.mockResolvedValue({ slots: [], plan: new Map() });
});
afterEach(() => vi.unstubAllGlobals());

const item = {
    type: "compound" as const,
    value: { id: { type: "string" as const, value: "minecraft:stone" } },
};
function menu(lists: Action[][]): ImportableMenu {
    return {
        type: "MENU",
        name: "Recovery",
        size: 1,
        slots: lists.map((actions, slot) => ({ slot, nbt: item, actions })),
    };
}
function sync(trust = buildTrustPlan(house, [], false)): ActionSyncContext {
    return {
        trust,
        canonicalizeItemName: (name) => name,
        resolveItem: vi.fn(),
        overwriteWarningMode: "always",
        conflicts: [],
        conflictEvidence: [],
        itemRead: { mode: "sync" },
    };
}
function plan(baseline: ImportableMenu, desired: ImportableMenu): MenuImportPlan {
    const actions = sync();
    const ops = desired.slots.flatMap((slot) => {
        const current =
            baseline.slots.find((entry) => entry.slot === slot.slot)?.actions ?? [];
        const actionsPlan = createKnownActionListPlan(slot.actions!, current, {
            sync: actions,
        });
        return actionsPlan.diff.operations.length === 0
            ? []
            : [{ slot: slot.slot, syncActions: slot.actions, actionsPlan }];
    });
    const partial = {
        kind: "MENU" as const,
        importable: desired,
        baseline,
        exists: true,
        diff: { setSize: null, ops },
    };
    return { ...partial, applicationPlan: menuApplicationPlan(partial) };
}
async function fail(plan: MenuImportPlan): Promise<ImportableMenu> {
    let thrown: unknown;
    try {
        await applyImportableMenuPlan(
            ctx as never,
            plan,
            {
                actions: sync(),
                ensuredReferencedShells: { menus: new Set() },
            } as ImportContext,
            new ApplicationProgress(plan.applicationPlan, undefined)
        );
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const partial = reconstructPartialMenu(plan, actionListApplyResultFromError(thrown));
    expect(partial).not.toBeNull();
    return partial!;
}
function persist(partial: ImportableMenu) {
    expect(
        writeImportableCache(ctx as never, house, partial, "importer", { partial: true })
    ).toBe(true);
    expect(
        upsertHouseLockImportable(source, house, {
            importable: partial,
            itemContent: undefined,
            partial: true,
        })
    ).toBe(true);
}
function rejectWith(result?: ActionListApplyResult): never {
    throw Object.assign(
        new Error("write failed"),
        result === undefined ? {} : { __htswActionListApplyResult: result }
    );
}

test("a mid-list failure retains confirmed slots and rescans only the failed list on retry", async () => {
    const baseline = menu([
        [message("old")],
        [message("old")],
        [message("unchanged")],
        [],
    ]);
    const desired = menu([
        [message("done")],
        [message("unfinished")],
        [message("unchanged")],
        [],
    ]);
    mocks.apply
        .mockImplementationOnce(async (_ctx: unknown, plan: ActionListPlan) => ({
            currentSnapshot: plan.desired,
            mutationStarted: true,
        }))
        .mockImplementationOnce(() => rejectWith());
    const partial = await fail(plan(baseline, desired));
    expect(partial.slots.map((slot) => slot.slot)).toEqual([0, 2, 3]);
    expect(partial.slots[0].actions).toEqual(desired.slots[0].actions);
    persist(partial);
    expect(readImportableCache(house, "MENU", "Recovery")?.partial).toBe(true);
    const trust = buildTrustPlan(house, [desired], true, source);
    const session = sync(trust);
    const opened: number[] = [];
    for (const slot of desired.slots) {
        await scanActionListSync(ctx as never, {
            desired: slot.actions,
            basePath: menuSlotActionsPath(slot.slot),
            sync: session,
            trustPlan: trust.importables.get("MENU:Recovery"),
            open: async () => {
                opened.push(slot.slot);
            },
        });
    }
    expect(opened).toEqual([1]);
    expect(mocks.scan).toHaveBeenCalledTimes(1);
});

test("a permission failure before mutation keeps the previous baseline, never a read-back of an outside edit", async () => {
    const baseline = menu([[message("baseline")], [message("other slot")]]);
    const desired = menu([
        [message("baseline"), message("add")],
        [message("other slot")],
    ]);
    mocks.apply.mockImplementationOnce(() =>
        rejectWith({ currentSnapshot: baseline.slots[0].actions! })
    );
    const partial = await fail(plan(baseline, desired));
    expect(partial).toEqual(baseline);
    expect(mocks.scan).not.toHaveBeenCalled();
    persist(partial);
    const trust = buildTrustPlan(house, [desired], false, source);
    const session = sync(trust);
    mocks.scan.mockResolvedValue({
        slots: [observedSlot(0, message("someone else's edit"))],
    });
    await readActionListPlan(ctx as never, desired.slots[0].actions!, {
        sync: session,
        conflictTarget: {
            type: "MENU",
            identity: "Recovery",
            basePath: menuSlotActionsPath(0),
        },
    });
    expect(session.conflicts).toHaveLength(1);
});

test("an outside edit on another slot still conflicts against its retained baseline", async () => {
    const baseline = menu([[message("old")], [message("untouched")]]);
    const desired = menu([[message("new")], [message("untouched")]]);
    mocks.apply.mockImplementationOnce(() => rejectWith());
    persist(await fail(plan(baseline, desired)));
    const trust = buildTrustPlan(house, [desired], false, source);
    const session = sync(trust);
    mocks.scan.mockResolvedValue({ slots: [observedSlot(0, message("outside edit"))] });
    await readActionListPlan(ctx as never, desired.slots[1].actions!, {
        sync: session,
        conflictTarget: {
            type: "MENU",
            identity: "Recovery",
            basePath: menuSlotActionsPath(1),
        },
    });
    expect(session.conflicts).toEqual([
        { type: "MENU", identity: "Recovery", basePath: menuSlotActionsPath(1) },
    ]);
    expect(
        readHouseLock(source)?.importables["MENU:Recovery"].listContentHashes?.[
            menuSlotActionsPath(0)
        ]
    ).toBeUndefined();
});

test("a safe snapshot after a mutation still leaves the failed list out", async () => {
    const baseline = menu([[message("old")], [message("untouched")]]);
    const desired = menu([[message("new")], [message("untouched")]]);
    mocks.apply.mockImplementationOnce(() =>
        rejectWith({ currentSnapshot: desired.slots[0].actions!, mutationStarted: true })
    );
    expect((await fail(plan(baseline, desired))).slots.map((slot) => slot.slot)).toEqual([
        1,
    ]);
});

test("partial cache cannot whole-trust a new source that omits the uncertain slot", async () => {
    const baseline = menu([[message("old")], [message("untouched")]]);
    const desired = menu([[message("new")], [message("untouched")]]);
    mocks.apply.mockImplementationOnce(() => rejectWith());
    const partial = await fail(plan(baseline, desired));
    persist(partial);
    const trust = buildTrustPlan(house, [partial], true, source).importables.get(
        "MENU:Recovery"
    )!;
    expect(trust.wholeImportableTrusted).toBe(false);
    expect(buildCacheStatusRow(house, partial).state).toBe("modified");
    expect(houseLockCurrentEntryFor(readHouseLock(source)!, house, partial)).toBeNull();
    expect(trust.trustedChildListPaths.has(menuSlotActionsPath(1))).toBe(true);
});

test.each([false, true])(
    "item selection failure only removes the slot after mutation starts: %s",
    async (mutated) => {
        const baseline = menu([[message("old")], [message("untouched")]]);
        const current = plan(baseline, baseline);
        current.diff.ops = [{ slot: 0, setItem: {} as Item }];
        current.applicationPlan = menuApplicationPlan(current);
        mocks.select.mockImplementationOnce(
            async (
                _ctx: unknown,
                _item: unknown,
                _label: unknown,
                _match: unknown,
                started: () => void
            ) => {
                if (mutated) started();
                throw new Error("item selection failed");
            }
        );
        const partial = await fail(current);
        expect(partial.slots).toEqual(mutated ? [baseline.slots[1]] : baseline.slots);
    }
);

test.each([false, true])(
    "resize failure preserves only confirmed size and slots: %s",
    async (mutated) => {
        const baseline = menu([[message("kept")], [message("outside new size")]]);
        baseline.size = 2;
        baseline.slots[1].slot = 12;
        const current = plan(baseline, baseline);
        current.diff.setSize = 1;
        current.applicationPlan = menuApplicationPlan(current);
        mocks.resize.mockImplementationOnce(
            async (_ctx: unknown, _size: unknown, started: () => void) => {
                if (mutated) started();
                throw new Error("resize failed");
            }
        );
        const partial = await fail(current);
        expect(partial.size).toBe(mutated ? undefined : 2);
        expect(partial.slots).toEqual(mutated ? [baseline.slots[0]] : baseline.slots);
    }
);

test("completed slot snapshots keep their item contents through a later list failure", async () => {
    const drop: Action = { type: "GIVE_ITEM", itemName: "../items/particle.snbt" };
    const baseline = menu([[message("old")], [message("old")]]);
    const desired = menu([[drop], [message("new")]]);
    mocks.apply
        .mockImplementationOnce(async () => ({
            currentSnapshot: [drop],
            mutationStarted: true,
            itemContent: (owner: Action, field: string) =>
                owner === drop && field === "itemName" ? "particle" : undefined,
        }))
        .mockImplementationOnce(() => rejectWith());
    const current = plan(baseline, desired);
    let error: unknown;
    try {
        await applyImportableMenuPlan(
            ctx as never,
            current,
            {
                actions: sync(),
                ensuredReferencedShells: { menus: new Set() },
            } as ImportContext,
            new ApplicationProgress(current.applicationPlan, undefined)
        );
    } catch (thrown) {
        error = thrown;
    }
    const result = actionListApplyResultFromError(error)!;
    expect(result.menuSnapshot?.slots[0].actions).toEqual([drop]);
    expect(result.itemContent?.(drop, "itemName")).toBe("particle");
});

test("planning keeps confirmed observed item owners and excludes unread slot lists", () => {
    const observed: Action = { type: "GIVE_ITEM", itemName: "live-item" };
    const desired = menu([[observed, message("new")], [message("new")]]);
    const first = createKnownActionListPlan(desired.slots[0].actions!, [observed], {
        sync: sync(),
    });
    first.observed[0].action = observed;
    const second = {
        ...createKnownActionListPlan(desired.slots[1].actions!, [], { sync: sync() }),
        observed: [{ index: 0, action: null, hydrated: false, truncatedFields: [] }],
    };
    const built = planImportableMenu(
        {
            kind: "MENU",
            importable: desired,
            grid: {
                size: 1,
                gridSize: 9,
                slots: [0, 1].map((slot) => ({
                    slot,
                    snbt: '{id:"minecraft:stone"}',
                    nameHint: "Stone",
                })),
            },
            slots: [first, second].map((plan, slot) => ({
                desiredIndex: slot,
                slot,
                label: "Stone",
                actions: { kind: "planned" as const, plan },
            })),
        },
        {
            items: { canonicalizeObservedName: (name: string) => name },
            actions: sync(),
        } as ImportContext
    );
    expect(built.baseline?.slots[0].actions?.[0]).toBe(observed);
    expect(built.baseline?.slots[1].actions).toBeUndefined();
});
