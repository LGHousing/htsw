import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    open: vi.fn(),
    read: vi.fn(),
    indexed: vi.fn(),
    find: vi.fn(),
    snapshot: vi.fn(),
}));
vi.mock("../src/importables/functions/housing", () => ({
    extractFunctionNameFromSlot: (name: string) => name,
    openFunctionEditor: mocks.open,
}));
vi.mock("../src/importables/functions/icon", () => ({ snapshotIconStack: mocks.snapshot }));
vi.mock("../src/housingSync/menus/currentMenu", () => ({ isAtMenuTitle: () => true }));
vi.mock("../src/importables/waiters", () => ({ functionListOpened: vi.fn() }));
vi.mock("../src/housingSync/menus/paginatedList", () => ({
    readPaginatedList: mocks.read,
    getPaginatedListSlotAtIndex: mocks.indexed,
    findPaginatedListEntry: mocks.find,
    getVisiblePaginatedItemSlots: vi.fn(),
    isEmptyPaginatedPlaceholder: vi.fn(),
}));

import {
    getSessionFunctionIcon,
    getSessionFunctionListSlot,
    getSessionFunctionNamesLower,
    invalidateFunctionListIndexHints,
    noteFunctionCreated,
    resetFunctionNameSession,
    setFunctionListIndexHints,
} from "../src/importables/functions/listFunctions";

const ctx = {} as never;
function slot(name: string) {
    return { getItem: () => ({ getName: () => name, getItemStack: () => ({ name }) }) };
}
function seed() {
    setFunctionListIndexHints("house-a", [{ name: "Target", index: 273 }]);
    resetFunctionNameSession("HOUSE-A");
}

beforeEach(() => {
    vi.resetAllMocks();
    resetFunctionNameSession();
    mocks.read.mockResolvedValue([{ name: "Target", index: 273, icon: null }]);
    mocks.open.mockResolvedValue("opened");
});

describe("one-import function index hints", () => {
    test("unseeded imports still enumerate; hints are consumed once and scoped to the house", async () => {
        seed();
        resetFunctionNameSession("house-a");
        expect(await getSessionFunctionNamesLower(ctx, ["Target"])).toEqual(new Set(["target"]));
        expect(mocks.read).toHaveBeenCalledOnce();
        setFunctionListIndexHints("house-a", [{ name: "Target", index: 273 }]);
        resetFunctionNameSession("house-b");
        await getSessionFunctionNamesLower(ctx, ["Target"]);
        expect(mocks.read).toHaveBeenCalledTimes(2);
        expect(mocks.open).not.toHaveBeenCalled();
    });

    test("neither stale presence nor stale absence is trusted, even between calls", async () => {
        seed();
        mocks.open.mockResolvedValueOnce("missing").mockResolvedValueOnce("opened").mockResolvedValueOnce("missing");
        expect(await getSessionFunctionNamesLower(ctx, ["Target", "Created elsewhere"])).toEqual(new Set(["created elsewhere"]));
        expect(await getSessionFunctionNamesLower(ctx, ["Created elsewhere"])).toEqual(new Set());
        expect(mocks.open.mock.calls.map(args => args[1])).toEqual(["Target", "Created elsewhere", "Created elsewhere"]);
        expect(mocks.read).not.toHaveBeenCalled();
    });

    test("empty hints still probe live; mutations discard pending hints before the import", async () => {
        setFunctionListIndexHints("house-a", []);
        resetFunctionNameSession("house-a");
        expect(await getSessionFunctionNamesLower(ctx, ["Not in the scan"])).toEqual(new Set(["not in the scan"]));
        expect(mocks.read).not.toHaveBeenCalled();
        setFunctionListIndexHints("house-a", [{ name: "Target", index: 273 }]);
        invalidateFunctionListIndexHints();
        resetFunctionNameSession("house-a");
        await getSessionFunctionNamesLower(ctx, ["Target"]);
        expect(mocks.read).toHaveBeenCalledOnce();
    });

    test("enumeration still performs a complete scan when hints are active", async () => {
        seed();
        await getSessionFunctionNamesLower(ctx);
        expect(mocks.read).toHaveBeenCalledOnce();
    });

    test("a stale index cannot select a different function or reuse its icon", async () => {
        seed();
        mocks.indexed.mockResolvedValue(slot("Wrong"));
        const correct = slot("Target");
        mocks.find.mockResolvedValue({ entry: { name: "Target", index: 5, icon: null }, slot: correct });
        mocks.snapshot.mockReturnValue({ item: "minecraft:diamond", count: 2, enchanted: true });
        expect(await getSessionFunctionIcon(ctx, "Target")).toEqual({ item: "minecraft:diamond", count: 2, enchanted: true });
        expect(mocks.find).toHaveBeenCalledOnce();
        expect(mocks.snapshot).toHaveBeenLastCalledWith({ name: "Target" });
        mocks.indexed.mockResolvedValue(correct);
        expect(await getSessionFunctionListSlot(ctx, "Target")).toBe(correct);
        expect(mocks.indexed.mock.calls[mocks.indexed.mock.calls.length - 1][1]).toBe(5);
    });

    test.each(["create", "delete", "rename"])("%s invalidates all positions", async mutation => {
        seed();
        if (mutation === "create") noteFunctionCreated("New");
        else invalidateFunctionListIndexHints();
        mocks.find.mockResolvedValue({ entry: { name: "Target", index: 0, icon: null }, slot: slot("Target") });
        await getSessionFunctionListSlot(ctx, "Target");
        expect(mocks.indexed).not.toHaveBeenCalled();
        expect(mocks.find).toHaveBeenCalledOnce();
        await getSessionFunctionNamesLower(ctx, ["Target"]);
        expect(mocks.open).toHaveBeenCalledOnce();
        expect(mocks.read).not.toHaveBeenCalled();
    });

    test("invalid seeds clear an earlier seed; host mutation cannot change copied hints", async () => {
        const hints = [{ name: "Target", index: 273 }];
        setFunctionListIndexHints("house-a", hints);
        hints[0].index = 0;
        resetFunctionNameSession("house-a");
        mocks.indexed.mockResolvedValue(slot("Target"));
        await getSessionFunctionListSlot(ctx, "Target");
        expect(mocks.indexed.mock.calls[0][1]).toBe(273);
        expect(() => setFunctionListIndexHints("house-a", [{ name: "Bad", index: -1 }])).toThrow();
        resetFunctionNameSession("house-a");
        await getSessionFunctionNamesLower(ctx, ["Target"]);
        expect(mocks.read).toHaveBeenCalledOnce();
    });
});
