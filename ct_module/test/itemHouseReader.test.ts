import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as htsw from "htsw";
import type { ImportableItem } from "htsw/types";
import type { ListReadOptions } from "../src/housingSync/context/actionReadContext";
import type { ActionListScan } from "../src/housingSync/actions/readList";

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
        hydrateActionListScan:
            vi.fn<
                (
                    ctx: unknown,
                    scan: ActionListScan,
                    read: ListReadOptions
                ) => Promise<void>
            >(),
        writeImportableCache: vi.fn(),
        upsertImportableEntry: vi.fn(),
        refuseEditor: false,
        summaries,
    };
});

vi.mock("../src/utils/nbt", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/utils/nbt")>()),
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
    hydrateActionListScan: mocks.hydrateActionListScan,
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
vi.mock("../src/project/paths", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/project/paths")>()),
    snbtTargetForItemExport: (importJsonPath: string, rootDir: string, name: string) => ({
        importJsonPath,
        snbtPath: `${rootDir}/items/${name}.snbt`,
        snbtReference: `items/${name}.snbt`,
    }),
}));
vi.mock("../src/project/importJsonMutations", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/project/importJsonMutations")>()),
    upsertImportableEntry: mocks.upsertImportableEntry,
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
import { exportCapturedItems } from "../src/importables/items/exportCapturedItems";
import { ItemCaptureRegistry } from "../src/importables/items/captureRegistry";
import * as projectDestination from "../src/importables/export/projectDestination";
import { runQueuedExportSession } from "../src/gui/right-panel/import-tab/queueRunner";
import { makeImportableQueueRow } from "../src/gui/right-panel/import-tab/queue";
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
        elapsedMs: () => 1000,
        runCommand: vi.fn(),
        expectAfter: async (run: () => unknown) => {
            await run();
            return mocks.refuseEditor ? "refused" : "opened";
        },
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
        mocks.refuseEditor = false;
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
        mocks.hydrateActionListScan.mockImplementation(async (_ctx, scan) => {
            scan.slots[0].action = message(side++ === 0 ? "left" : "right");
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("dispatches a successful queued ITEM read to the real session and caches both live lists", async () => {
        vi.spyOn(projectDestination, "readProjectItemsForExport").mockReturnValue([
            sourceItem(),
        ]);
        const row = makeImportableQueueRow({
            op: "read",
            house: "house",
            path: "/project/import.json",
            type: "ITEM",
            identity: "cookie",
        });
        const result = await runQueuedExportSession(
            context() as unknown as TaskContext,
            [row],
            "house"
        );
        expect(result).toEqual({ completedKeys: [row.key], failed: [] });
        expect(mocks.writeImportableCache).toHaveBeenCalledWith(
            expect.anything(),
            "house",
            expect.objectContaining({
                type: "ITEM",
                name: "cookie",
                leftClickActions: [message("left")],
                rightClickActions: [message("right")],
            }),
            "reader"
        );
    });

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
        mocks.hydrateActionListScan.mockImplementation(async (_ctx, scan) => {
            scan.slots[0].action = message("changed in Housing");
        });
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
        {
            action: { type: "CONDITIONAL", ifActions: [], elseActions: [] },
            hydrated: true,
        },
    ])("keeps unrecognized or incomplete actions unknown (%j)", async (entry) => {
        mocks.scanActionList.mockResolvedValue({ slots: [entry] });
        mocks.hydrateActionListScan.mockResolvedValue(undefined);
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
        mocks.hydrateActionListScan.mockImplementation(async (_ctx, scan, options) => {
            if (options.itemReadMode !== "export")
                throw new Error("Expected item captures");
            const itemName = options.itemCaptures.register(
                '{id:"minecraft:apple"}',
                "apple"
            );
            scan.slots[0].action = { type: "GIVE_ITEM", itemName };
        });
        const { live } = await read();
        const entry = live.get("ITEM:cookie")!;
        const action = (entry.importable as ImportableItem).leftClickActions![0];
        expect(entry.itemContent(action, "itemName")).toBe(
            canonicalItemShellTagKey(htsw.nbt.parseSnbtText('{id:"minecraft:apple"}'))
        );
    });

    it("keeps an explicit Housing item-editor refusal unknown and restores inventory", async () => {
        mocks.refuseEditor = true;
        const { report } = await read();
        expect(report).toMatchObject({ clean: 0, conflicts: [], unknown: 2 });
        expect(mocks.scanActionList).not.toHaveBeenCalled();
        expect(mocks.restoreTemporarilyHeldItem).toHaveBeenCalledOnce();
        expect(mocks.restorePlayerInventory).toHaveBeenCalledOnce();
    });

    it("exports a protected cookie reference without trying to hold or edit it", async () => {
        const writes: Record<string, string> = {};
        vi.stubGlobal("FileLib", {
            exists: () => false,
            read: () => null,
            write: (path: string, content: string) => {
                writes[path] = content;
            },
        });
        const registry = new ItemCaptureRegistry("live");
        registry.register(
            '{id:"minecraft:cookie",tag:{ExtraAttributes:{COOKIE_ITEM:1b}}}',
            "cookie"
        );
        const ctx = context();
        const count = await exportCapturedItems(
            ctx as unknown as TaskContext,
            registry,
            "/project",
            "/project/import.json",
            "house"
        );
        expect(count).toBe(1);
        expect(
            Object.entries(writes).some(
                ([path, snbt]) => path.endsWith(".snbt") && snbt.includes("COOKIE_ITEM")
            )
        ).toBe(true);
        expect(mocks.upsertImportableEntry).toHaveBeenCalledWith(
            "/project/import.json",
            "items",
            {
                name: "cookie",
                nbt: "items/cookie.snbt",
            }
        );
        expect(mocks.temporarilyHoldItem).not.toHaveBeenCalled();
        expect(ctx.runCommand).not.toHaveBeenCalled();
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
