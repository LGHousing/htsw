import type { Action, ImportableItem } from "htsw/types";

import { syncActionList } from "../../importer/actions";
import { clickGoBack, timedWaitForMenu } from "../../importer/helpers";
import {
    getCurrentHousingUuid,
    importableHash,
    itemSnbtCachePath,
    writeKnowledge,
    type ImportableTrustPlan,
} from "../../knowledge";
import TaskContext from "../../tasks/context";
import { stableStringify } from "../../utils/helpers";
import { getItemFromNbt, getItemFromSnbt } from "../../utils/nbt";
import {
    HOTBAR_ZERO_PACKET_SLOT,
    SET_SLOT_ACK_TIMEOUT_MS,
    selectHotbarSlot,
    selectedHotbarSlot,
    sendCreativeInventoryAction,
    waitForAnySetSlot,
} from "../../importer/packets";
import { actionListTrustFor } from "../actionListTrust";
import type { ItemRegistry } from "../itemRegistry";
import { ensureReferencedImportablesExist } from "../references";
import type { ActionListProgress } from "../../importer/types";
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

async function waitForHotbarZeroMatch(ctx: TaskContext, stack: any): Promise<void> {
    while (!hotbarZeroMatches(stack)) {
        await waitForAnySetSlot(ctx);
        await ctx.waitFor("tick");
    }
}

export async function importImportableItem(
    ctx: TaskContext,
    importable: ImportableItem,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    cachedUuid?: string,
    onActionListProgress?: (progress: ActionListProgress) => void
): Promise<void> {
    await ensureReferencedImportablesExist(ctx, importable);

    const uuid = cachedUuid ?? (await getCurrentHousingUuid(ctx));
    if (!hasItemClickActions(importable)) {
        await injectHeldItem(ctx, getItemFromNbt(importable.nbt));
        writeItemKnowledge(ctx, uuid, importable);
        return;
    }

    const hash = importableHash(importable);
    const cachePath = itemSnbtCachePath(uuid, hash);
    if (FileLib.exists(cachePath)) {
        writeItemKnowledge(ctx, uuid, importable);
        return;
    }

    const start = chooseItemStart(uuid, importable, trustPlan);
    await injectHeldItem(ctx, start.item);

    await ctx.runCommand("/edit");
    await timedWaitForMenu(ctx, "commandMenuWait");

    ctx.getItemSlot("Edit Actions").click();
    await timedWaitForMenu(ctx, "menuClickWait");

    await syncItemActionLists(
        ctx,
        importable,
        itemRegistry,
        trustPlan,
        start,
        onActionListProgress
    );

    await timed("sleep1000", COST.guaranteedSleep1000, () => ctx.sleep(1000));

    const snbt = Player.getInventory()?.getStackInSlot(selectedHotbarSlot())?.getRawNBT();
    if (!snbt) throw Error("Why don't we have the item?");

    FileLib.write(cachePath, snbt, true);
    writeItemKnowledge(ctx, uuid, importable);
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
                "selecting hotbar slot 0 for already-present import item"
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
                `selecting existing hotbar slot ${existingHotbarSlot} for import item`
            );
        }
        return;
    }

    try {
        const ack = waitForHotbarZeroMatch(ctx, stack);
        sendCreativeInventoryAction(
            ctx,
            HOTBAR_ZERO_PACKET_SLOT,
            stack,
            `injecting import item &f${item.getName()}`
        );
        await ctx.withTimeout(
            ack,
            "held item injection ack",
            SET_SLOT_ACK_TIMEOUT_MS
        );
    } catch (error) {
        if (!hotbarZeroMatches(stack)) {
            throw error;
        }
        ctx.displayMessage(
            "&e[packet] held item ack was not observed, but hotbar slot 0 matches; continuing."
        );
    }
    await ctx.waitFor("tick");

    if (selectedHotbarSlot() !== 0) {
        selectHotbarSlot(
            ctx,
            0,
            "selecting hotbar slot 0 after import item injection"
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
    onActionListProgress?: (progress: ActionListProgress) => void
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
            trust: actionListTrustFor(trustPlan, "leftClickActions", leftDesired),
            onProgress: onActionListProgress,
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
            trust: actionListTrustFor(trustPlan, "rightClickActions", rightDesired),
            onProgress: onActionListProgress,
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

function writeItemKnowledge(
    ctx: TaskContext,
    housingUuid: string,
    importable: ImportableItem
): void {
    try {
        writeKnowledge(ctx, housingUuid, importable, "importer");
    } catch (error) {
        ctx.displayMessage(`&7[knowledge] &eSkipped cache write for ITEM: ${error}`);
    }
}
