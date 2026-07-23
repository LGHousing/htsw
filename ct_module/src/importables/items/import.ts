import type { Action, ImportableItem } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/apply";
import type { ActionListPlan } from "../../housingSync/actions/plan";
import {
    actionListPlanFromRead,
    readActionListSync,
    type ActionListSyncResult,
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
import type { ImportContext } from "../import/context";
import type { ItemDependencyIndex } from "./dependencyIndex";
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

type ItemStart =
    | {
          item: Item;
          mode: "source";
      }
    | {
          item: Item;
          mode: "cached";
          cachedImportable: ImportableItem;
      };

export type ItemImportPlan = {
    kind: "ITEM";
    importable: ImportableItem;
    housingUuid: string;
    item: Item;
    leftPlan: ActionListPlan | null;
    rightPlan: ActionListPlan | null;
    usesCachedInteractData: boolean;
};

export type ItemRead = {
    kind: "ITEM";
    importable: ImportableItem;
    housingUuid: string;
    item: Item;
    left: ActionListSyncResult | null;
    right: ActionListSyncResult | null;
    usesCachedInteractData: boolean;
};

export async function readImportableItem(
    ctx: TaskContext,
    importable: ImportableItem,
    session: ImportContext,
    trustPlan?: ImportableTrustPlan
): Promise<ItemRead> {
    const dependencyIndex = session.itemDependencies;
    const cachedInteractData = readInteractDataCache(
        importable,
        dependencyIndex,
        session.housingUuid
    );
    if (!hasItemClickActions(importable) || cachedInteractData !== undefined) {
        return {
            kind: "ITEM",
            importable,
            housingUuid: session.housingUuid,
            item:
                cachedInteractData === undefined
                    ? getItemFromNbt(importable.nbt)
                    : itemWithInteractData(importable.nbt, cachedInteractData),
            left: null,
            right: null,
            usesCachedInteractData: cachedInteractData !== undefined,
        };
    }

    const start = chooseItemStart(
        session.housingUuid,
        importable,
        trustPlan,
        dependencyIndex
    );
    const actions = await scanItemActionLists(ctx, importable, session, start);
    return {
        kind: "ITEM",
        importable,
        housingUuid: session.housingUuid,
        item: start.item,
        ...actions,
        usesCachedInteractData: false,
    };
}

export function planImportableItem(read: ItemRead): ItemImportPlan {
    return {
        kind: "ITEM",
        importable: read.importable,
        housingUuid: read.housingUuid,
        item: read.item,
        leftPlan: read.left === null ? null : actionListPlanFromRead(read.left),
        rightPlan: read.right === null ? null : actionListPlanFromRead(read.right),
        usesCachedInteractData: read.usesCachedInteractData,
    };
}

export async function applyImportableItemPlan(
    ctx: TaskContext,
    plan: ItemImportPlan,
    session: ImportContext
): Promise<void> {
    const { importable } = plan;
    const events = session.actions.events;
    const ownSteps = hasItemClickActions(importable) ? 3 : 1;
    const setup = createSetupStepEmitter(
        events,
        ownSteps
    );

    const uuid = plan.housingUuid;
    const dependencyIndex = session.itemDependencies;
    const needsActionApply = plan.leftPlan !== null || plan.rightPlan !== null;
    if (!needsActionApply) {
        const placement = await placeImportedItem(ctx, plan.item);
        try {
            setup(
                plan.usesCachedInteractData
                    ? `gave cached ${importable.name}`
                    : `gave ${importable.name}`
            );
            await tryWriteImportableCache(ctx, importable, "importer", uuid, {
                itemDependencies: dependencyIndex.snapshotOf(importable),
            });
        } finally {
            await restoreImportedItemPlacement(ctx, placement);
        }
        return;
    }

    const placement = await placeImportedItem(ctx, plan.item);
    try {
        setup(`injected item ${importable.name}`);

        await ctx.expectAfter(() => ctx.runCommand("/edit"), itemEditorOpened());
        setup(`opened item editor`);

        ctx.getItemSlot("Edit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        setup(`opened Edit Actions for ${importable.name}`);

        await applyItemActionPlans(ctx, plan, session);

        await timed("sleep1000", COST.guaranteedSleep1000, () => ctx.sleep(1000));

        const snbt = Player.getInventory()
            ?.getStackInSlot(selectedHotbarSlot())
            ?.getRawNBT();
        if (!snbt) throw Error("Why don't we have the item?");

        const interactData = extractInteractDataSnbt(snbt);
        if (interactData === null) {
            throw new Error(
                `Could not capture interact_data after applying click actions to '${importable.name}'.`
            );
        }
        if (!writeInteractDataCache(importable, dependencyIndex, uuid, interactData)) {
            throw new Error(
                `Could not save interact_data after applying click actions to '${importable.name}'.`
            );
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

async function scanItemActionLists(
    ctx: TaskContext,
    importable: ImportableItem,
    session: ImportContext,
    start: ItemStart
): Promise<Pick<ItemRead, "left" | "right">> {
    const cachedLeft =
        start.mode === "cached" ? start.cachedImportable.leftClickActions : undefined;
    const cachedRight =
        start.mode === "cached" ? start.cachedImportable.rightClickActions : undefined;
    const leftDesired = actionListToSync(
        importable.leftClickActions,
        cachedLeft,
        start.mode
    );
    const rightDesired = actionListToSync(
        importable.rightClickActions,
        cachedRight,
        start.mode
    );

    const left = await readActionListSync(ctx, {
        desired: leftDesired,
        sync: session.actions,
        basePath: "leftClickActions",
        current: currentItemActionList(start.mode, cachedLeft),
    });

    const right = await readActionListSync(ctx, {
        desired: rightDesired,
        sync: session.actions,
        basePath: "rightClickActions",
        current: currentItemActionList(start.mode, cachedRight),
    });

    return { left, right };
}

function currentItemActionList(
    mode: ItemStart["mode"],
    cached: readonly Action[] | undefined
): { kind: "known-empty" } | { kind: "known"; actions: readonly Action[] } {
    return mode === "source"
        ? { kind: "known-empty" }
        : { kind: "known", actions: cached ?? [] };
}

async function applyItemActionPlans(
    ctx: TaskContext,
    plan: ItemImportPlan,
    session: ImportContext
): Promise<void> {
    if (plan.leftPlan !== null) {
        ctx.getItemSlot("Left Click Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        await applyActionListPlan(ctx, plan.leftPlan, { sync: session.actions });
        if (plan.rightPlan !== null) await clickGoBack(ctx);
    }

    if (plan.rightPlan !== null) {
        ctx.getItemSlot("Right Click Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        await applyActionListPlan(ctx, plan.rightPlan, { sync: session.actions });
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
