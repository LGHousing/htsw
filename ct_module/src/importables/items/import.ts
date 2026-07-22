import type { Action, ImportableItem } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/apply";
import type { ActionListPlan } from "../../housingSync/actions/plan";
import {
    actionListPlanFromRead,
    hydrateActionListSync,
    scanActionListSync,
    type ActionListSyncScanResult,
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
    restoreTemporarilyHeldItem,
    temporarilyHoldItem,
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

type ItemStart = {
    item: Item;
    mode: "cached" | "source";
    cachedImportable?: ImportableItem;
};

export type ItemImportPlan = {
    kind: "ITEM";
    importable: ImportableItem;
    trustPlan?: ImportableTrustPlan;
    housingUuid: string;
    item: Item;
    leftPlan: ActionListPlan | null;
    rightPlan: ActionListPlan | null;
    usesCachedInteractData: boolean;
};

export type ItemRead = {
    kind: "ITEM";
    importable: ImportableItem;
    trustPlan?: ImportableTrustPlan;
    housingUuid: string;
    item: Item;
    left: ActionListSyncScanResult | null;
    right: ActionListSyncScanResult | null;
    usesCachedInteractData: boolean;
};

export async function scanImportableItem(
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
            trustPlan,
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
    const held = await temporarilyHoldItem(ctx, start.item);
    try {
        await ctx.expectAfter(() => ctx.runCommand("/edit"), itemEditorOpened());
        ctx.getItemSlot("Edit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        const actions = await scanItemActionLists(
            ctx,
            importable,
            session,
            trustPlan,
            start
        );
        return {
            kind: "ITEM",
            importable,
            trustPlan,
            housingUuid: session.housingUuid,
            item: start.item,
            ...actions,
            usesCachedInteractData: false,
        };
    } finally {
        await restoreTemporarilyHeldItem(ctx, held);
    }
}

export async function hydrateImportableItem(
    ctx: TaskContext,
    read: ItemRead
): Promise<void> {
    if (read.left?.kind !== "hydrate" && read.right?.kind !== "hydrate") return;
    const held = await temporarilyHoldItem(ctx, read.item);
    try {
        if (read.left?.kind === "hydrate") {
            await openItemActionsRoot(ctx);
            read.left = await hydrateActionListSync(ctx, read.left, false);
        }
        if (read.right?.kind === "hydrate") {
            await openItemActionsRoot(ctx);
            read.right = await hydrateActionListSync(ctx, read.right, false);
        }
    } finally {
        await restoreTemporarilyHeldItem(ctx, held);
    }
}

async function openItemActionsRoot(ctx: TaskContext): Promise<void> {
    await ctx.expectAfter(() => ctx.runCommand("/edit"), itemEditorOpened());
    ctx.getItemSlot("Edit Actions").click();
    await timedWaitForMenu(ctx, "menuClickWait");
}

export function planImportableItem(read: ItemRead): ItemImportPlan {
    return {
        kind: "ITEM",
        importable: read.importable,
        trustPlan: read.trustPlan,
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

async function scanItemActionLists(
    ctx: TaskContext,
    importable: ImportableItem,
    session: ImportContext,
    trustPlan: ImportableTrustPlan | undefined,
    start: ItemStart
): Promise<Pick<ItemRead, "left" | "right">> {
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

    const leftEditor = { opened: false };
    const left = await scanActionListSync(ctx, {
        desired: leftDesired,
        sync: session.actions,
        trustPlan,
        basePath: "leftClickActions",
        open: async () => {
            ctx.getItemSlot("Left Click Actions").click();
            await timedWaitForMenu(ctx, "menuClickWait");
            leftEditor.opened = true;
        },
    });
    if (leftEditor.opened) {
        await clickGoBack(ctx);
    }

    const right = await scanActionListSync(ctx, {
        desired: rightDesired,
        sync: session.actions,
        trustPlan,
        basePath: "rightClickActions",
        open: async () => {
            ctx.getItemSlot("Right Click Actions").click();
            await timedWaitForMenu(ctx, "menuClickWait");
        },
    });

    return { left, right };
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
