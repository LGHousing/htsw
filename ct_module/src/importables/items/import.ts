import type { Action, ImportableItem } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/apply";
import {
    prepareActionListSync,
    shouldSyncActionList,
} from "../../housingSync/actions/prepareSync";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { tryWriteImportableCache, type ImportableTrustPlan } from "../../importCache";
import TaskContext from "../../tasks/context";
import { stableStringify } from "../../utils/helpers";
import {
    extractInteractDataSnbt,
    getItemFromNbt,
    itemWithInteractData,
} from "../../utils/nbt";
import { selectedHotbarSlot } from "../../housingSync/menus/packets";
import {
    placeImportedItem,
    restoreImportedItemPlacement,
} from "../../housingSync/items/heldItem";
import type { ImportSession } from "../imports";
import type { ItemDependencyIndex } from "./dependencyIndex";
import { createMissingReferencedShells } from "../references";
import { countReferencedShells } from "../referenceScanner";
import { itemEditorOpened } from "../waiters";
import { COST } from "../../housingSync/progress/costs";
import { timed } from "../../housingSync/progress/timing";
import {
    hasItemClickActions,
    readInteractDataCache,
    writeInteractDataCache,
} from "./interactDataCache";

function sourceItemShell(importable: ImportableItem): object {
    return {
        type: importable.type,
        name: importable.name,
        nbt: importable.nbt,
    };
}

function cachedSourceItemShellMatches(
    cached: ImportableItem,
    desired: ImportableItem
): boolean {
    return (
        stableStringify(sourceItemShell(cached)) ===
        stableStringify(sourceItemShell(desired))
    );
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
    const setup = createSetupStepEmitter(
        events,
        countReferencedShells(importable) + ownSteps
    );

    await createMissingReferencedShells(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const uuid = cachedUuid ?? session.housingUuid;
    const dependencyIndex = session.itemDependencies;
    if (!hasItemClickActions(importable)) {
        const placement = await placeImportedItem(ctx, getItemFromNbt(importable.nbt));
        try {
            setup(`gave ${importable.name}`);
            await tryWriteImportableCache(ctx, importable, "importer", uuid, {
                itemDependencies: dependencyIndex.snapshotOf(importable),
            });
        } finally {
            await restoreImportedItemPlacement(ctx, placement);
        }
        return;
    }

    const cachedInteractData = readInteractDataCache(importable, dependencyIndex, uuid);
    if (cachedInteractData !== undefined) {
        const placement = await placeImportedItem(
            ctx,
            itemWithInteractData(importable.nbt, cachedInteractData)
        );
        try {
            setup(`gave cached ${importable.name}`);
            await tryWriteImportableCache(ctx, importable, "importer", uuid, {
                itemDependencies: dependencyIndex.snapshotOf(importable),
            });
        } finally {
            await restoreImportedItemPlacement(ctx, placement);
        }
        return;
    }

    const start = chooseItemStart(uuid, importable, trustPlan, dependencyIndex);
    const placement = await placeImportedItem(ctx, start.item);
    try {
        setup(`injected item ${importable.name}`);

        await ctx.expectAfter(() => ctx.runCommand("/edit"), itemEditorOpened());
        setup(`opened item editor`);

        ctx.getItemSlot("Edit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        setup(`opened Edit Actions for ${importable.name}`);

        await syncItemActionLists(ctx, importable, session, trustPlan, start);

        await timed("sleep1000", COST.guaranteedSleep1000, () => ctx.sleep(1000));

        const snbt = Player.getInventory()
            ?.getStackInSlot(selectedHotbarSlot())
            ?.getRawNBT();
        if (!snbt) throw Error("Why don't we have the item?");

        const interactData = extractInteractDataSnbt(snbt);
        if (interactData !== null) {
            writeInteractDataCache(importable, dependencyIndex, uuid, interactData);
        }
        await tryWriteImportableCache(ctx, importable, "importer", uuid, {
            itemDependencies: dependencyIndex.snapshotOf(importable),
        });
    } finally {
        await restoreImportedItemPlacement(ctx, placement);
    }
}

function chooseItemStart(
    housingUuid: string,
    importable: ImportableItem,
    trustPlan: ImportableTrustPlan | undefined,
    dependencyIndex: ItemDependencyIndex
): ItemStart {
    const cachedEntry = trustPlan?.entry;
    if (cachedEntry === undefined || cachedEntry === null) {
        return {
            item: getItemFromNbt(importable.nbt),
            mode: "source",
        };
    }

    const cachedImportable = cachedEntry.importable;
    if (
        cachedImportable.type === "ITEM" &&
        cachedSourceItemShellMatches(cachedImportable, importable)
    ) {
        const cachedInteractData = readInteractDataCache(
            cachedImportable,
            dependencyIndex,
            housingUuid
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
        const editor = { opened: false };
        const openActionsEditor = async (): Promise<void> => {
            ctx.getItemSlot("Left Click Actions").click();
            await timedWaitForMenu(ctx, "menuClickWait");
            editor.opened = true;
        };
        const leftSync = await prepareActionListSync(ctx, {
            desired: leftDesired,
            session,
            trustPlan,
            basePath: "leftClickActions",
            open: openActionsEditor,
        });
        if (leftSync.kind === "planned") {
            if (!editor.opened) await openActionsEditor();
            await applyActionListPlan(ctx, leftSync.plan, { session });
        }

        if (rightNeedsSync) {
            await clickGoBack(ctx);
        }
    }

    if (rightNeedsSync) {
        const editor = { opened: false };
        const openActionsEditor = async (): Promise<void> => {
            ctx.getItemSlot("Right Click Actions").click();
            await timedWaitForMenu(ctx, "menuClickWait");
            editor.opened = true;
        };
        const rightSync = await prepareActionListSync(ctx, {
            desired: rightDesired,
            session,
            trustPlan,
            basePath: "rightClickActions",
            open: openActionsEditor,
        });
        if (rightSync.kind === "planned") {
            if (!editor.opened) await openActionsEditor();
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
