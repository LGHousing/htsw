import type { Action, ImportableItem } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/applyDiff";
import { prereadActionList } from "../../housingSync/actions/plan";
import { createSetupStepEmitter } from "../../housingSync/progress/setupStepEmitter";
import { clickGoBack } from "../../housingSync/gui/menuUtils";
import { timedWaitForMenu } from "../../housingSync/gui/menuWait";
import {
    clickActionsHash,
    interactDataCachePath,
    tryWriteImportableCache,
    type ImportableTrustPlan,
} from "../../importCache";
import TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import { stableStringify } from "../../utils/helpers";
import {
    extractInteractDataSnbt,
    getItemFromNbt,
    itemWithInteractData,
} from "../../utils/nbt";
import {
    HOTBAR_ZERO_PACKET_SLOT,
    SET_SLOT_ACK_MAX_TICKS,
    selectHotbarSlot,
    selectedHotbarSlot,
    sendCreativeInventoryAction,
} from "../../housingSync/gui/packets";
import { getActionListTrust, getBaselineActionList } from "../actionListHelpers";
import type { ImportSession } from "../imports";
import {
    countReferencedShells,
    ensureReferencedImportablesExist,
} from "../references";
import { COST } from "../../housingSync/progress/costs";
import { timed } from "../../housingSync/progress/timing";

// The 9th hotbar slot (index 8) is excluded from import: it can't be the item
// that enters Housing menus, and an item sitting there (typically the player's
// game-menu item) must not be reused as a spawn — we spawn fresh into slot 0
// instead. See issue #58.
const IMPORTABLE_HOTBAR_SLOTS = 8;

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

function readCachedInteractData(housingUuid: string, actionsHash: string): string | undefined {
    const path = interactDataCachePath(housingUuid, actionsHash);
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
    for (let slot = 0; slot < IMPORTABLE_HOTBAR_SLOTS; slot++) {
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

export async function prereadImportableItem(
    _ctx: TaskContext,
    importable: ImportableItem,
    session: ImportSession,
    trustPlan?: ImportableTrustPlan
): Promise<ItemImportPlan> {
    return { kind: "ITEM", importable, trustPlan, housingUuid: session.housingUuid };
}

export async function applyImportableItemPlan(
    ctx: TaskContext,
    plan: ItemImportPlan,
    session: ImportSession
): Promise<void> {
    await importImportableItem(
        ctx,
        plan.importable,
        session,
        plan.trustPlan,
        plan.housingUuid
    );
}

async function importImportableItem(
    ctx: TaskContext,
    importable: ImportableItem,
    session: ImportSession,
    trustPlan?: ImportableTrustPlan,
    cachedUuid?: string
): Promise<void> {
    const events = session.events;
    const ownSteps = hasItemClickActions(importable) ? 3 : 1;
    const setup = createSetupStepEmitter(events, countReferencedShells(importable) + ownSteps);

    await ensureReferencedImportablesExist(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const uuid = cachedUuid ?? session.housingUuid;
    if (!hasItemClickActions(importable)) {
        await injectHeldItem(ctx, getItemFromNbt(importable.nbt));
        setup(`gave ${importable.name}`);
        await tryWriteImportableCache(ctx, importable, "importer", uuid);
        return;
    }

    const actionsHash = clickActionsHash(
        importable.leftClickActions,
        importable.rightClickActions
    );
    const cachePath = interactDataCachePath(uuid, actionsHash);
    const cachedInteractData = readCachedInteractData(uuid, actionsHash);
    if (cachedInteractData !== undefined) {
        await injectHeldItem(ctx, itemWithInteractData(importable.nbt, cachedInteractData));
        setup(`gave cached ${importable.name}`);
        await tryWriteImportableCache(ctx, importable, "importer", uuid);
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
        session,
        trustPlan,
        start
    );

    await timed("sleep1000", COST.guaranteedSleep1000, () => ctx.sleep(1000));

    const snbt = Player.getInventory()?.getStackInSlot(selectedHotbarSlot())?.getRawNBT();
    if (!snbt) throw Error("Why don't we have the item?");

    // Cache only the housing-scoped interact_data blob (keyed by action hash),
    // not the whole snapshot — a later reference splices it onto the source item.
    const interactData = extractInteractDataSnbt(snbt);
    if (interactData !== null) {
        ensureParentDirs(cachePath);
        FileLib.write(cachePath, interactData, true);
    }
    await tryWriteImportableCache(ctx, importable, "importer", uuid);
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
        const cachedInteractData = readCachedInteractData(
            housingUuid,
            clickActionsHash(
                cachedImportable.leftClickActions,
                cachedImportable.rightClickActions
            )
        );
        if (cachedInteractData !== undefined) {
            return {
                item: itemWithInteractData(cachedImportable.nbt, cachedInteractData),
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

async function switchToHotbarSlot(ctx: TaskContext, slot: number): Promise<void> {
    if (selectedHotbarSlot() === slot) return;
    selectHotbarSlot(ctx, slot);
    // The held-slot change only reaches the server on the next client tick, when
    // vanilla flushes C09PacketHeldItemChange. Yield a tick so a following /edit
    // (or creative spawn) acts on the newly held item, not the previous one —
    // otherwise the import can run against the wrong slot. See issue #57.
    await ctx.waitFor("tick");
}

async function injectHeldItem(ctx: TaskContext, item: Item): Promise<void> {
    const stack = item.getItemStack();
    if (stack === null || stack === undefined) {
        throw new Error("Cannot inject an empty item stack.");
    }

    const existingHotbarSlot = findMatchingHotbarSlot(stack);
    if (existingHotbarSlot !== null) {
        await switchToHotbarSlot(ctx, existingHotbarSlot);
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

    await switchToHotbarSlot(ctx, 0);
    await timed("sleep1000", COST.guaranteedSleep1000, () => ctx.sleep(1000));
}

async function syncItemActionLists(
    ctx: TaskContext,
    importable: ImportableItem,
    session: ImportSession,
    trustPlan: ImportableTrustPlan | undefined,
    start: ItemStart
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

        const leftPlan = await prereadActionList(ctx, leftDesired, {
            session,
            baselineCurrent: getBaselineActionList(trustPlan, "leftClickActions"),
            trust: getActionListTrust(trustPlan, "leftClickActions"),
        });
        await applyActionListPlan(ctx, leftPlan, { session });

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

        const rightPlan = await prereadActionList(ctx, rightDesired, {
            session,
            baselineCurrent: getBaselineActionList(trustPlan, "rightClickActions"),
            trust: getActionListTrust(trustPlan, "rightClickActions"),
        });
        await applyActionListPlan(ctx, rightPlan, { session });
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

