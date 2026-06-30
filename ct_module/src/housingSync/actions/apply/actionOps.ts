import { Diagnostic } from "htsw";
import type { Action } from "htsw/types";

import type { ItemRegistry } from "../../../importables/itemRegistry";
import TaskContext from "../../../tasks/context";
import { MouseButton, menuStateDescription } from "../../../tasks/specifics/slots";
import {
    clickGoBack,
    getSlotPaginate,
    isLimitExceeded,
    setNoteOnLastVisibleSlot,
} from "../../gui/menuUtils";
import { timedWaitForMenu, waitForMenu } from "../../gui/menuWait";
import {
    getPaginatedListSlotAtIndex,
    goToPaginatedListPage,
} from "../../gui/paginatedList";
import { COST } from "../../progress/costs";
import { timed } from "../../progress/timing";
import type { ActionApplyContext } from "../../context/actionApplyContext";
import {
    appendConditionsToOpenConditionList,
} from "../conditions/apply";
import { ACTION_LIST_CONFIG } from "../listConfigs";
import { getActionSpec, writeOpenAction } from "../specs";

type ImportActionCallbacks = {
    onActionAdded?: () => void;
};

export function actionWithNote(action: Action, note: string | undefined): Action {
    return note === action.note ? action : { ...action, note };
}

export async function addAction(
    ctx: TaskContext,
    action: Action,
    itemRegistry: ItemRegistry,
    apply?: ActionApplyContext,
    callbacks?: ImportActionCallbacks
): Promise<void> {
    ctx.getMenuItemSlot("Add Action").click();
    await timedWaitForMenu(ctx, "menuClickWait");

    const spec = getActionSpec(action.type);
    const displayName = spec.displayName;

    await clickAddActionOption(ctx, action.type, displayName);
    if (!spec.write) {
        callbacks?.onActionAdded?.();
    }

    if (spec.write) {
        await writeOpenAction(ctx, action, {
            itemRegistry,
            apply,
        });
        callbacks?.onActionAdded?.();
        await clickGoBack(ctx);
    }

    await setNoteOnLastVisibleSlot(ctx, action.note);
}

export async function appendActionsToOpenActionList(
    ctx: TaskContext,
    desired: Action[],
    itemRegistry: ItemRegistry
): Promise<void> {
    const apply: ActionApplyContext = {
        markHeaderApplied: () => undefined,
        shouldApplyList: () => true,

        async applyInnerActions(_prop, args) {
            await appendActionsToOpenActionList(ctx, args.desired, itemRegistry);
        },

        async applyConditions(_prop, args) {
            await appendConditionsToOpenConditionList(
                ctx,
                args.desired,
                itemRegistry
            );
        },
    };
    for (let i = 0; i < desired.length; i++) {
        await addAction(ctx, desired[i], itemRegistry, apply);
    }
    if (desired.length > 0) {
        await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    }
}

export async function deleteObservedAction(
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<void> {
    const slot = await getPaginatedListSlotAtIndex(ctx, index, listLength, ACTION_LIST_CONFIG);
    slot.click(MouseButton.RIGHT);
    await timedWaitForMenu(ctx, "menuClickWait");
}

export async function moveActionToIndex(
    ctx: TaskContext,
    fromIndex: number,
    toIndex: number,
    listLength: number
): Promise<void> {
    if (listLength <= 1) {
        return;
    }

    const targetIndex = ((toIndex % listLength) + listLength) % listLength;
    let currentIndex = ((fromIndex % listLength) + listLength) % listLength;

    for (let attempt = 0; attempt < 128 && currentIndex !== targetIndex; attempt++) {
        const rightDistance = (targetIndex - currentIndex + listLength) % listLength;
        const leftDistance = (currentIndex - targetIndex + listLength) % listLength;
        const button =
            leftDistance <= rightDistance ? MouseButton.LEFT : MouseButton.RIGHT;

        const currentSlot = await getPaginatedListSlotAtIndex(ctx, currentIndex, listLength, ACTION_LIST_CONFIG);
        currentSlot.click(button, true);
        await timed("reorderStep", COST.reorderStep, () => waitForMenu(ctx));

        if (button === MouseButton.LEFT) {
            currentIndex = (currentIndex - 1 + listLength) % listLength;
        } else {
            currentIndex = (currentIndex + 1) % listLength;
        }
    }

    if (currentIndex !== targetIndex) {
        throw new Error(
            `Failed to move action from index ${fromIndex} to ${toIndex} within ${listLength} item(s).`
        );
    }
}

async function clickAddActionOption(
    ctx: TaskContext,
    actionType: Action["type"],
    displayName: string
): Promise<void> {
    const slot = await getSlotPaginate(ctx, displayName);

    if (isLimitExceeded(slot, "action")) {
        throw Diagnostic.error(`Maximum amount of ${displayName} actions exceeded`);
    }

    const wait = timedWaitForMenu(ctx, "menuClickWait");
    slot.click();
    try {
        await wait;
    } catch (error) {
        throw new Error(
            `After clicking Add Action option "${displayName}" (${actionType})${menuStateDescription()}: ${errorMessage(error)}`
        );
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
