import type { Action, ImportableItem } from "htsw/types";

import { syncActionList } from "../../importer/actions";
import { clickGoBack, waitForMenu } from "../../importer/helpers";
import {
    getCurrentHousingUuid,
    importableHash,
    writeKnowledge,
    type ImportableTrustPlan,
} from "../../knowledge";
import TaskContext from "../../tasks/context";
import { stableStringify } from "../../utils/helpers";
import { getItemFromNbt, getItemFromSnbt } from "../../utils/nbt";
import {
    C09PacketHeldItemChange,
    C10PacketCreativeInventoryAction,
} from "../../utils/packets";
import { actionListTrustFor } from "../actionListTrust";
import type { ItemRegistry } from "../itemRegistry";
import { ensureReferencedImportablesExist } from "../references";

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

function itemSnbtCachePath(housingUuid: string, hash: string): string {
    return `./htsw/.cache/${housingUuid}/items/${hash}.snbt`;
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

export async function importImportableItem(
    ctx: TaskContext,
    importable: ImportableItem,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    cachedUuid?: string
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
    await waitForMenu(ctx);

    ctx.getItemSlot("Edit Actions").click();
    await waitForMenu(ctx);

    await syncItemActionLists(ctx, importable, itemRegistry, trustPlan, start);

    await ctx.sleep(1000);

    const snbt = Player.getInventory()?.getStackInSlot(0)?.getRawNBT();
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
    Client.sendPacket(new C10PacketCreativeInventoryAction(36, item.getItemStack()));
    if (Player.getPlayer().field_71071_by.field_70461_c !== 0) {
        Client.sendPacket(new C09PacketHeldItemChange(0));
        Player.getPlayer().field_71071_by.field_70461_c = 0;
    }
    await ctx.sleep(1000);
}

async function syncItemActionLists(
    ctx: TaskContext,
    importable: ImportableItem,
    itemRegistry: ItemRegistry,
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
        await waitForMenu(ctx);

        await syncActionList(ctx, leftDesired, {
            itemRegistry,
            trust: actionListTrustFor(trustPlan, "leftClickActions", leftDesired),
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
        await waitForMenu(ctx);

        await syncActionList(ctx, rightDesired, {
            itemRegistry,
            trust: actionListTrustFor(trustPlan, "rightClickActions", rightDesired),
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
