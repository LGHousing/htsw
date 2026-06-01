import type { Action, ImportableItem } from "htsw/types";

import { syncActionList } from "../../importer/actions/sync";
import type { ImportEventHandler } from "../../importer/importEvents";
import { createSetupStepEmitter } from "../../importer/progress/setupStepEmitter";
import { clickGoBack } from "../../importer/gui/helpers";
import { IMPORT_DEBUG } from "../../importer/diagnostics/importDebug";
import { timedWaitForMenu } from "../../importer/gui/menuWait";
import {
    getCurrentHousingUuid,
    importableHash,
    itemSnbtCachePath,
    writeImportableCache,
    type ImportableTrustPlan,
} from "../../importCache";
import TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import { stableStringify } from "../../utils/helpers";
import { getItemFromNbt, getItemFromSnbt } from "../../utils/nbt";
import {
    HOTBAR_ZERO_PACKET_SLOT,
    SET_SLOT_ACK_MAX_TICKS,
    selectHotbarSlot,
    selectedHotbarSlot,
    sendCreativeInventoryAction,
} from "../../importer/gui/packets";
import { getActionListTrust, getBaselineActionList } from "../actionListHelpers";
import type { ItemRegistry } from "../itemRegistry";
import {
    countReferencedShells,
    ensureReferencedImportablesExist,
} from "../references";
import { COST } from "../../importer/progress/costs";
import { timed } from "../../importer/progress/timing";

function hasItemClickActions(importable: ImportableItem): boolean {
    return (
        (importable.leftClickActions?.length ?? 0) > 0 ||
        (importable.rightClickActions?.length ?? 0) > 0
    );
}

function itemShell(importable: ImportableItem): object {
    return {
        type: importable.type,
        name: importable.name,
        nbt: importable.nbt,
    };
}

function itemShellMatchesCached(
    cached: ImportableItem,
    desired: ImportableItem
): boolean {
    return stableStringify(itemShell(cached)) === stableStringify(itemShell(desired));
}

function readCachedItemSnbt(housingUuid: string, hash: string): string | undefined {
    const path = itemSnbtCachePath(housingUuid, hash);
    if (!FileLib.exists(path)) return undefined;

    const raw = FileLib.read(path);
    return raw === null ? undefined : String(raw);
}

type ItemStart = {
    item: Item;
    mode: "cached" | "source";
    cachedImportable?: ImportableItem;
};

function hotbarSlotMatches(slot: number, stack: any): boolean {
    const current = Player.getInventory()?.getStackInSlot(slot);
    return (
        current !== null &&
        current !== undefined &&
        stacksEqual(current.getItemStack(), stack)
    );
}

function hotbarZeroMatches(stack: any): boolean {
    return hotbarSlotMatches(0, stack);
}

function findMatchingHotbarSlot(stack: any): number | null {
    for (let slot = 0; slot < 9; slot++) {
        if (hotbarSlotMatches(slot, stack)) {
            return slot;
        }
    }
    return null;
}

function stacksEqual(left: any, right: any): boolean {
    // func_179549_c = ItemStack.areItemStacksEqual, including item, damage, size, and NBT.
    return left.func_179549_c(right);
}

// Must stay a finite for-loop, not a `while (!match) await SetSlot` wrapped in a
// timeout: on timeout that leaks a SetSlot waiter that re-registers itself on
// every future SetSlot.
async function waitForHotbarZeroMatch(ctx: TaskContext, stack: any): Promise<boolean> {
    for (let i = 0; i < SET_SLOT_ACK_MAX_TICKS; i++) {
        if (hotbarZeroMatches(stack)) return true;
        await ctx.waitFor("tick");
    }
    return hotbarZeroMatches(stack);
}

export type ItemImportPlan = {
    kind: "ITEM";
    importable: ImportableItem;
    trustPlan?: ImportableTrustPlan;
    housingUuid?: string;
};

/**
 * ITEM stays single-pass: item injection, /edit, and SNBT capture form a
 * tightly coupled sequence that doesn't split cleanly. Preread records a
 * minimal plan; all real work happens in `applyImportableItemPlan`.
 */
export async function prereadImportableItem(
    _ctx: TaskContext,
    importable: ImportableItem,
    _itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    cachedUuid?: string,
    _events?: ImportEventHandler
): Promise<ItemImportPlan> {
    return { kind: "ITEM", importable, trustPlan, housingUuid: cachedUuid };
}

export async function applyImportableItemPlan(
    ctx: TaskContext,
    plan: ItemImportPlan,
    itemRegistry: ItemRegistry,
    events?: ImportEventHandler
): Promise<void> {
    await importImportableItem(
        ctx,
        plan.importable,
        itemRegistry,
        plan.trustPlan,
        plan.housingUuid,
        events
    );
}

async function importImportableItem(
    ctx: TaskContext,
    importable: ImportableItem,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    cachedUuid?: string,
    events?: ImportEventHandler
): Promise<void> {
    const ownSteps = hasItemClickActions(importable) ? 3 : 1;
    const setup = createSetupStepEmitter(events, countReferencedShells(importable) + ownSteps);

    await ensureReferencedImportablesExist(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const uuid = cachedUuid ?? (await getCurrentHousingUuid(ctx));
    if (!hasItemClickActions(importable)) {
        await injectHeldItem(ctx, getItemFromNbt(importable.nbt));
        setup(`injected item ${importable.name}`);
        writeItemCache(ctx, uuid, importable);
        return;
    }

    const hash = importableHash(importable);
    const cachePath = itemSnbtCachePath(uuid, hash);
    if (FileLib.exists(cachePath)) {
        writeItemCache(ctx, uuid, importable);
        return;
    }

    const start = chooseItemStart(uuid, importable, trustPlan);
    await injectHeldItem(ctx, start.item);
    setup(`injected item ${importable.name}`);

    await ctx.runCommand("/edit");
    await timedWaitForMenu(ctx, "commandMenuWait");
    setup(`opened item editor`);

    ctx.getItemSlot("Edit Actions").click();
    await timedWaitForMenu(ctx, "menuClickWait");
    setup(`opened Edit Actions for ${importable.name}`);

    await syncItemActionLists(
        ctx,
        importable,
        itemRegistry,
        trustPlan,
        start,
        events
    );

    await timed("sleep1000", COST.guaranteedSleep1000, () => ctx.sleep(1000));

    const snbt = Player.getInventory()?.getStackInSlot(selectedHotbarSlot())?.getRawNBT();
    if (!snbt) throw Error("Why don't we have the item?");

    ensureParentDirs(cachePath);
    FileLib.write(cachePath, snbt, true);
    writeItemCache(ctx, uuid, importable);
}

function chooseItemStart(
    housingUuid: string,
    importable: ImportableItem,
    trustPlan: ImportableTrustPlan | undefined
): ItemStart {
    const cachedEntry = trustPlan?.entry;
    if (cachedEntry === undefined || cachedEntry === null) {
        return {
            item: getItemFromNbt(importable.nbt),
            mode: "source",
        };
    }

    const cachedImportable = cachedEntry?.importable;
    if (
        cachedImportable?.type === "ITEM" &&
        itemShellMatchesCached(cachedImportable, importable)
    ) {
        const cachedSnbt = readCachedItemSnbt(housingUuid, cachedEntry.hash);
        if (cachedSnbt !== undefined) {
            return {
                item: getItemFromSnbt(cachedSnbt),
                mode: "cached",
                cachedImportable,
            };
        }
    }

    return {
        item: getItemFromNbt(importable.nbt),
        mode: "source",
    };
}

async function injectHeldItem(ctx: TaskContext, item: Item): Promise<void> {
    const stack = item.getItemStack();
    if (stack === null || stack === undefined) {
        throw new Error("Cannot inject an empty item stack.");
    }

    if (hotbarZeroMatches(stack)) {
        if (selectedHotbarSlot() !== 0) {
            selectHotbarSlot(
                ctx,
                0,
            );
        }
        return;
    }

    const existingHotbarSlot = findMatchingHotbarSlot(stack);
    if (existingHotbarSlot !== null) {
        if (selectedHotbarSlot() !== existingHotbarSlot) {
            selectHotbarSlot(
                ctx,
                existingHotbarSlot,
            );
        }
        return;
    }

    sendCreativeInventoryAction(
        ctx,
        HOTBAR_ZERO_PACKET_SLOT,
        stack,
    );
    const landed = await waitForHotbarZeroMatch(ctx, stack);
    if (!landed) {
        throw new Error(
            `held item injection never reached hotbar slot 0 within ${SET_SLOT_ACK_MAX_TICKS} ticks.`
        );
    }
    await ctx.waitFor("tick");

    if (selectedHotbarSlot() !== 0) {
        selectHotbarSlot(
            ctx,
            0,
        );
    }
    await timed("sleep1000", COST.guaranteedSleep1000, () => ctx.sleep(1000));
}

async function syncItemActionLists(
    ctx: TaskContext,
    importable: ImportableItem,
    itemRegistry: ItemRegistry,
    trustPlan: ImportableTrustPlan | undefined,
    start: ItemStart,
    events?: ImportEventHandler
): Promise<void> {
    const leftDesired = actionListToSync(
        importable.leftClickActions,
        start.cachedImportable?.leftClickActions,
        start.mode
    );
    const rightDesired = actionListToSync(
        importable.rightClickActions,
        start.cachedImportable?.rightClickActions,
        start.mode
    );

    if (
        leftDesired !== undefined &&
        !trustPlan?.trustedListPaths.has("leftClickActions")
    ) {
        ctx.getItemSlot("Left Click Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");

        await syncActionList(ctx, leftDesired, {
            itemRegistry,
            baselineCurrent: getBaselineActionList(trustPlan, "leftClickActions"),
            trust: getActionListTrust(trustPlan, "leftClickActions"),
            events,
        });

        if (
            rightDesired !== undefined &&
            !trustPlan?.trustedListPaths.has("rightClickActions")
        ) {
            await clickGoBack(ctx);
        }
    }

    if (
        rightDesired !== undefined &&
        !trustPlan?.trustedListPaths.has("rightClickActions")
    ) {
        ctx.getItemSlot("Right Click Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");

        await syncActionList(ctx, rightDesired, {
            itemRegistry,
            baselineCurrent: getBaselineActionList(trustPlan, "rightClickActions"),
            trust: getActionListTrust(trustPlan, "rightClickActions"),
            events,
        });
    }
}

function actionListToSync(
    desired: Action[] | undefined,
    cached: Action[] | undefined,
    mode: ItemStart["mode"]
): Action[] | undefined {
    if (desired !== undefined && desired.length > 0) {
        return desired;
    }

    if (mode === "cached" && cached !== undefined && cached.length > 0) {
        return [];
    }

    return undefined;
}

function writeItemCache(
    ctx: TaskContext,
    housingUuid: string,
    importable: ImportableItem
): void {
    try {
        writeImportableCache(ctx, housingUuid, importable, "importer");
    } catch (error) {
        if (IMPORT_DEBUG) {
            ctx.displayMessage(`&7[knowledge] &eSkipped cache write for ITEM: ${error}`);
        }
    }
}
