import type { Action, ImportableItem } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/apply";
import {
    prepareActionListSync,
    shouldSyncActionList,
} from "../../housingSync/actions/prepareSync";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
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
import { selectedHotbarSlot } from "../../housingSync/menus/packets";
import type { ImportSession } from "../imports";
import { createMissingReferencedShells } from "../references";
import { countReferencedShells } from "../referenceScanner";
import { itemEditorOpened } from "../waiters";
import { COST } from "../../housingSync/progress/costs";
import { timed } from "../../housingSync/progress/timing";
import { injectHeldItem } from "./heldItem";

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

    await createMissingReferencedShells(ctx, importable, (kind, name) => {
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

    await ctx.expectAfter(
        () => ctx.runCommand("/edit"),
        itemEditorOpened()
    );
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

    const leftNeedsSync = shouldSyncActionList(
        leftDesired,
        trustPlan,
        "leftClickActions"
    );
    const rightNeedsSync = shouldSyncActionList(
        rightDesired,
        trustPlan,
        "rightClickActions"
    );

    if (leftNeedsSync) {
        const leftSync = await prepareActionListSync(ctx, {
            desired: leftDesired,
            session,
            trustPlan,
            basePath: "leftClickActions",
            open: async () => {
                ctx.getItemSlot("Left Click Actions").click();
                await timedWaitForMenu(ctx, "menuClickWait");
            },
        });
        if (leftSync.kind === "planned") {
            await applyActionListPlan(ctx, leftSync.plan, { session });
        }

        if (rightNeedsSync) {
            await clickGoBack(ctx);
        }
    }

    if (rightNeedsSync) {
        const rightSync = await prepareActionListSync(ctx, {
            desired: rightDesired,
            session,
            trustPlan,
            basePath: "rightClickActions",
            open: async () => {
                ctx.getItemSlot("Right Click Actions").click();
                await timedWaitForMenu(ctx, "menuClickWait");
            },
        });
        if (rightSync.kind === "planned") {
            await applyActionListPlan(ctx, rightSync.plan, { session });
        }
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
