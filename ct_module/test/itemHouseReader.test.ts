import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as htsw from "htsw";
import type { Action, ImportableItem } from "htsw/types";
import type { ListReadOptions } from "../src/housingSync/context/actionReadContext";

type FakeItem = { snbt: string };

const mocks = vi.hoisted(() => {
    const summaries: Record<string, string[]> = {};
    return {
        slots: [] as Array<FakeItem | null>,
        held: null as FakeItem | null,
        temporarilyHoldItem: vi.fn<(ctx: unknown, item: FakeItem) => Promise<object>>(),
        restoreTemporarilyHeldItem: vi.fn(),
        restorePlayerInventory: vi.fn(),
        scanActionList: vi.fn(),
        completeActionListScan:
            vi.fn<
                (ctx: unknown, scan: unknown, read: ListReadOptions) => Promise<Action[]>
            >(),
        writeImportableCache: vi.fn(),
        summaries,
    };
});

vi.mock("../src/utils/nbt", () => ({
    getItemFromSnbt: (snbt: string) => ({ snbt }),
    itemToHtswTag: (item: { snbt: string }) => htsw.nbt.parseSnbtText(item.snbt),
}));
vi.mock("../src/housingSync/items/heldItem", () => ({
    temporarilyHoldItem: mocks.temporarilyHoldItem,
    restoreTemporarilyHeldItem: mocks.restoreTemporarilyHeldItem,
}));
vi.mock("../src/housingSync/items/playerInventory", () => ({
    heldItem: () => mocks.held,
    snapshotPlayerInventory: () => ({
        slots: mocks.slots.slice(),
        selectedHotbarSlot: 4,
    }),
    restorePlayerInventory: mocks.restorePlayerInventory,
}));
vi.mock("../src/housingSync/actions/readList", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/housingSync/actions/readList")>()),
    scanActionList: mocks.scanActionList,
}));
vi.mock("../src/housingSync/actions/hydration/run", () => ({
    completeActionListScan: mocks.completeActionListScan,
}));
vi.mock("../src/housingSync/menus/menuUtils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/housingSync/menus/menuUtils")>()),
    clickGoBack: async () => undefined,
}));
vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: async () => undefined,
}));
vi.mock("../src/importCache/cache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/importCache/cache")>()),
    writeImportableCache: mocks.writeImportableCache,
}));

import type TaskContext from "../src/tasks/context";
import type { LiveDiffImportable } from "../src/slashCommands/diffReport";
import {
    evaluateDiffReport,
    matchDiffActionLists,
} from "../src/slashCommands/diffReport";
import { readItems } from "../src/importables/items/readHouseItems";
import { HOUSE_READERS, HOUSE_READABLE_TYPES } from "../src/importables/export/readers";
import { importableHash } from "../src/importCache/hash";
import { canonicalItemShellTagKey } from "../src/housingSync/items/itemNbt";
import { message } from "./utils";

const SHELL = '{id:"minecraft:cookie",tag:{display:{Name:"Cookie"}}}';
const signed = (signature: string): string =>
    `{id:"minecraft:cookie",Count:1b,Damage:0s,tag:{display:{Name:"Cookie"},ExtraAttributes:{interact_data:"${signature}"}}}`;

function sourceItem(): ImportableItem {
    return {
        type: "ITEM",
        name: "cookie",
        nbt: htsw.nbt.parseSnbtText(SHELL),
        leftClickActions: [message("left")],
        rightClickActions: [message("right")],
    };
}

function context() {
    return {
        checkCancelled: vi.fn(),
        displayMessage: vi.fn(),
        runCommand: vi.fn(),
        expectAfter: async (run: () => unknown) => run(),
        getItemSlot: (label: string) => ({
            click: vi.fn(),
            getItem: () => ({ getLore: () => mocks.summaries[label] ?? [] }),
        }),
    };
}

async function read(projectItems = [sourceItem()], names = ["cookie"]) {
    const live = new Map<string, LiveDiffImportable>();
    const ctx = context();
    const result = await readItems(ctx as unknown as TaskContext, {
        importJsonPath: "",
        rootDir: "",
        projectItems,
        names,
        quiet: true,
        output: {
            kind: "memory",
            housingUuid: "house",
            accept: (importable, itemContent) =>
                live.set(`ITEM:${(importable as ImportableItem).name}`, {
                    importable,
                    itemContent,
                }),
        },
    });
    const report = evaluateDiffReport(
        "house",
        matchDiffActionLists(projectItems, live),
        null
    ).report;
    return { result, live, report, ctx };
}

describe("item house reader", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.slots = Array.from({ length: 36 }, () => null);
        mocks.slots[35] = { snbt: signed("live") };
        mocks.held = null;
        mocks.summaries = {};
        vi.stubGlobal("Player", {
            getInventory: () => ({ getStackInSlot: (slot: number) => mocks.slots[slot] }),
        });
        mocks.temporarilyHoldItem.mockImplementation(async (_itemCtx, item) => {
            mocks.held = item;
            return { selectedHotbarSlot: 4 };
        });
        mocks.scanActionList.mockResolvedValue({
            slots: [{ action: message("read"), hydrated: true }],
        });
        let side = 0;
        mocks.completeActionListScan.mockImplementation(async () => [
            message(side++ === 0 ? "left" : "right"),
        ]);
    });

    afterEach(() => vi.unstubAllGlobals());

    it("registers ITEM and reads both lists from the signed live stack, including main inventory", async () => {
        expect(HOUSE_READERS.ITEM).toBe(readItems);
        expect(HOUSE_READABLE_TYPES).toContain("ITEM");
        const { result, live, report, ctx } = await read();
        expect(result).toEqual({ total: 1, succeeded: 1, failed: 0 });
        expect(report).toMatchObject({ clean: 2, conflicts: [], unknown: 0 });
        expect(mocks.temporarilyHoldItem.mock.calls[0][1].snbt).toContain(
            'interact_data:"live"'
        );
        expect(ctx.runCommand).toHaveBeenCalledWith("/edit");
        expect((live.get("ITEM:cookie")!.importable as ImportableItem).nbt).toEqual(
            htsw.nbt.parseSnbtText(
                SHELL.replace(
                    'id:"minecraft:cookie",',
                    'id:"minecraft:cookie",Count:1b,Damage:0s,'
                )
            )
        );
        expect(mocks.writeImportableCache).not.toHaveBeenCalled();
        expect(mocks.restoreTemporarilyHeldItem).toHaveBeenCalledOnce();
        expect(mocks.restorePlayerInventory).toHaveBeenCalledOnce();
    });

    it("compares changed live actions instead of the source or cached actions", async () => {
        mocks.completeActionListScan.mockResolvedValue([message("changed in Housing")]);
        const { report } = await read();
        expect(report).toMatchObject({ clean: 0, unknown: 0 });
        expect(report.conflicts).toHaveLength(2);
    });

    it("reads explicit empty lists as empty, so removed actions conflict", async () => {
        mocks.summaries = {
            "Left Click Actions": ["§7Actions:", "§7- None"],
            "Right Click Actions": ["Actions:", "- None"],
        };
        const { report } = await read();
        expect(report.conflicts).toHaveLength(2);
        expect(report.unknown).toBe(0);
        expect(mocks.scanActionList).not.toHaveBeenCalled();
    });

    it.each([
        { action: null, hydrated: false },
        { action: { type: "CONDITIONAL", ifActions: [null] }, hydrated: false },
    ])("keeps unrecognized or incomplete actions unknown (%j)", async (entry) => {
        mocks.scanActionList.mockResolvedValue({ slots: [entry] });
        mocks.completeActionListScan.mockResolvedValue([]);
        const { result, report } = await read();
        expect(result.failed).toBe(1);
        expect(report).toMatchObject({ clean: 0, conflicts: [], unknown: 2 });
        expect(mocks.restoreTemporarilyHeldItem).toHaveBeenCalledOnce();
    });

    it("keeps missing or changed NBT unknown even with the same display name", async () => {
        mocks.slots[35] = { snbt: SHELL.replace("minecraft:cookie", "minecraft:apple") };
        const { report } = await read();
        expect(report).toMatchObject({ clean: 0, conflicts: [], unknown: 2 });
        expect(mocks.temporarilyHoldItem).not.toHaveBeenCalled();
    });

    it("rejects ambiguous project names without relying on cached signatures", async () => {
        const other = { ...sourceItem(), name: "another_cookie" };
        const { report } = await read([sourceItem(), other]);
        expect(report.unknown).toBe(4);
        expect(mocks.temporarilyHoldItem).not.toHaveBeenCalled();
    });

    it("does not inject a source signature when no live inventory copy exists", async () => {
        mocks.slots[35] = null;
        const source = { ...sourceItem(), nbt: htsw.nbt.parseSnbtText(signed("source")) };
        const { report } = await read([source]);
        expect(report).toMatchObject({ clean: 0, conflicts: [], unknown: 2 });
        expect(mocks.temporarilyHoldItem).not.toHaveBeenCalled();
    });

    it("rejects inventory copies with different signatures, but accepts identical duplicates", async () => {
        mocks.slots[0] = { snbt: signed("older") };
        expect((await read()).report.unknown).toBe(2);
        expect(mocks.temporarilyHoldItem).not.toHaveBeenCalled();
        mocks.slots[0] = { snbt: signed("live") };
        expect((await read()).report.unknown).toBe(0);
    });

    it("rejects a swapped held item even when its material and display name match", async () => {
        mocks.temporarilyHoldItem.mockImplementation(async () => {
            mocks.held = { snbt: signed("replaced") };
            return {};
        });
        const { report, ctx } = await read();
        expect(report.unknown).toBe(2);
        expect(ctx.runCommand).not.toHaveBeenCalled();
        expect(mocks.restoreTemporarilyHeldItem).toHaveBeenCalledOnce();
    });

    it("restores inventory and reports unknown on a failed menu read", async () => {
        mocks.scanActionList.mockRejectedValueOnce(new Error("menu timeout"));
        expect((await read()).report.unknown).toBe(2);
        expect(mocks.restoreTemporarilyHeldItem).toHaveBeenCalledOnce();
        expect(mocks.restorePlayerInventory).toHaveBeenCalledOnce();
    });

    it("preserves captured item-field content for diff comparison", async () => {
        mocks.completeActionListScan.mockImplementation(async (_ctx, _scan, options) => {
            if (options.itemReadMode !== "export")
                throw new Error("Expected item captures");
            const itemName = options.itemCaptures.register(
                '{id:"minecraft:apple"}',
                "apple"
            );
            return [{ type: "GIVE_ITEM", itemName }];
        });
        const { live } = await read();
        const entry = live.get("ITEM:cookie")!;
        const action = (entry.importable as ImportableItem).leftClickActions![0];
        expect(entry.itemContent(action, "itemName")).toBe(
            canonicalItemShellTagKey(htsw.nbt.parseSnbtText('{id:"minecraft:apple"}'))
        );
    });

    it("hashes source and read-back items alike after Housing default NBT and signing", () => {
        const source = sourceItem();
        const live = { ...source, nbt: htsw.nbt.parseSnbtText(signed("live")) };
        expect(importableHash(live)).toBe(importableHash(source));
        expect(
            importableHash({
                ...live,
                nbt: htsw.nbt.parseSnbtText(signed("live").replace("Cookie", "Changed")),
            })
        ).not.toBe(importableHash(source));
    });
});
