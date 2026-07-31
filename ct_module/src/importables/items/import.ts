import type { Action, ImportableItem } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/apply";
import type { ActionListPlan } from "../../housingSync/actions/plan";
import {
    actionListPlanFromRead,
    readActionListSync,
    type ActionListSyncResult,
} from "../../housingSync/actions/prepareSync";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import type { ImportableTrustPlan } from "../../importCache";
import TaskContext from "../../tasks/context";
import { stableStringify } from "../../utils/helpers";
import {
    extractInteractDataSnbt,
    getItemFromNbt,
    itemWithInteractData,
} from "../../utils/nbt";
import { heldItem } from "../../housingSync/items/playerInventory";
import type { ImportContext } from "../import/context";
import type { ItemDependencyIndex } from "./dependencyIndex";
import { itemEditorOpened } from "../waiters";
import { COST } from "../../housingSync/progress/costs";
import {
    hasItemClickActions,
    readInteractDataCache,
    writeInteractDataCache,
} from "./interactDataCache";
import {
    actionListStep,
    defineApplicationPlan,
    workStep,
    type ApplicationPlan,
    type ApplicationProgress,
    type ApplicationStep,
} from "../import/applicationProgress";

const INTERACT_DATA_SIGN_MAX_TICKS = 60;

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

export function itemPlanApplicationUnits(plan: ItemImportPlan): number {
    return itemApplicationPlan(plan).totalUnits;
}

export function itemApplicationPlan(plan: ItemImportPlan): ApplicationPlan {
    const steps: ApplicationStep[] = [workStep("placeItem", COST.itemInject)];
    if (plan.leftPlan !== null || plan.rightPlan !== null) {
        steps.push(
            workStep("openItemEditor", COST.commandInterval + COST.commandMenuWait),
            workStep("openActionsEditor", COST.menuClickWait)
        );
        if (plan.leftPlan !== null) {
            steps.push(
                workStep("openLeftActions", COST.menuClickWait),
                actionListStep("leftActions", plan.leftPlan)
            );
            if (plan.rightPlan !== null) {
                steps.push(workStep("leaveLeftActions", COST.goBackWait));
            }
        }
        if (plan.rightPlan !== null) {
            steps.push(
                workStep("openRightActions", COST.menuClickWait),
                actionListStep("rightActions", plan.rightPlan)
            );
        }
        steps.push(
            workStep("captureInteractData", COST.nbtCapture),
            workStep("interactDataCache", COST.cacheWrite)
        );
    }
    steps.push(workStep("cache", COST.cacheWrite));
    return defineApplicationPlan(steps);
}

export async function applyImportableItemPlan(
    ctx: TaskContext,
    plan: ItemImportPlan,
    session: ImportContext,
    application: ApplicationProgress
): Promise<void> {
    const { importable } = plan;

    const uuid = plan.housingUuid;
    const dependencyIndex = session.itemDependencies;
    const needsActionApply = plan.leftPlan !== null || plan.rightPlan !== null;
    if (!needsActionApply) {
        await application.run("placeItem", () =>
            session.itemPlacement.place(ctx, plan.item)
        );
        return;
    }

    await application.run("placeItem", () => session.itemPlacement.place(ctx, plan.item));

    await application.run("openItemEditor", () =>
        ctx.expectAfter(() => ctx.runCommand("/edit"), itemEditorOpened())
    );

    await application.run("openActionsEditor", async () => {
        ctx.getItemSlot("Edit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
    });

    await applyItemActionPlans(ctx, plan, session, application);

    let interactData: string | null = null;
    await application.run("captureInteractData", async () => {
        // Housing re-signs the held item after its click actions change and
        // pushes the new stack to the client; wait for a blob that differs
        // from what we placed instead of sleeping a fixed second.
        const placedInteractData = extractInteractDataSnbt(
            plan.item.getRawNBT() ?? ""
        );
        const signedInteractData = (): string | null => {
            const snbt = heldItem()?.getRawNBT();
            if (!snbt) return null;
            const current = extractInteractDataSnbt(snbt);
            return current !== null && current !== placedInteractData
                ? current
                : null;
        };
        for (let tick = 0; tick < INTERACT_DATA_SIGN_MAX_TICKS; tick++) {
            interactData = signedInteractData();
            if (interactData !== null) return;
            await ctx.waitFor("tick");
        }
        interactData = signedInteractData();
        if (interactData === null) {
            throw new Error(
                `Could not capture interact_data after applying click actions to '${importable.name}'.`
            );
        }
    });
    await application.run("interactDataCache", async () => {
        if (
            interactData === null ||
            !writeInteractDataCache(importable, dependencyIndex, uuid, interactData)
        ) {
            throw new Error(
                `Could not save interact_data after applying click actions to '${importable.name}'.`
            );
        }
    });
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
    session: ImportContext,
    application: ApplicationProgress
): Promise<void> {
    const leftPlan = plan.leftPlan;
    if (leftPlan !== null) {
        await application.run("openLeftActions", async () => {
            ctx.getItemSlot("Left Click Actions").click();
            await timedWaitForMenu(ctx, "menuClickWait");
        });
        await application.runActionList(
            "leftActions",
            leftPlan,
            session.actions,
            (sync) => applyActionListPlan(ctx, leftPlan, { sync })
        );
        if (plan.rightPlan !== null) {
            await application.run("leaveLeftActions", () => clickGoBack(ctx));
        }
    }

    const rightPlan = plan.rightPlan;
    if (rightPlan !== null) {
        await application.run("openRightActions", async () => {
            ctx.getItemSlot("Right Click Actions").click();
            await timedWaitForMenu(ctx, "menuClickWait");
        });
        await application.runActionList(
            "rightActions",
            rightPlan,
            session.actions,
            (sync) => applyActionListPlan(ctx, rightPlan, { sync })
        );
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
