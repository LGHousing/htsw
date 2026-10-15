import { Diagnostic } from "htsw";
import type { Action } from "htsw/types";

import type { ResolveItemField } from "../../items/itemReferences";
import TaskContext from "../../../tasks/context";
import { MouseButton, menuStateDescription } from "../../../tasks/specifics/slots";
import {
    clickGoBack,
    CycleFieldReadError,
    getSlotPaginate,
    isLimitExceeded,
    setNoteOnLastVisibleSlot,
} from "../../menus/menuUtils";
import { timedWaitForMenu, waitForMenu } from "../../menus/menuWait";
import {
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    parsePaginatedTitlePage,
    readPaginatedList,
    isEmptyPaginatedPlaceholder,
    goToPaginatedListPage,
} from "../../menus/paginatedList";
import { removedFormatting } from "../../../utils/helpers";
import { itemLore } from "../../../utils/itemLore";
import { COST } from "../../progress/costs";
import { timed } from "../../progress/timing";
import type { ActionApplyContext } from "../../context/actionApplyContext";
import { appendConditionsToOpenConditionList } from "../conditions/apply";
import { ACTION_LIST_CONFIG } from "../listConfigs";
import { getActionIo, writeOpenAction } from "../io";
import { isTaskCancelled } from "../../../tasks/manager";
import {
    assertOneLevelActionTree,
    isChildAction,
    type ChildAction,
} from "../childActions";

type ImportActionCallbacks = {
    onMutationStarted?: () => void;
    onActionAdded?: () => void;
};

type MutationCallbacks = {
    onMutationStarted?: () => void;
};

export function actionWithNote(action: Action, note: string | undefined): Action {
    return note === action.note ? action : { ...action, note };
}

export async function addAction(
    ctx: TaskContext,
    action: Action,
    resolveItem: ResolveItemField,
    apply: ActionApplyContext,
    listLength: number,
    callbacks?: ImportActionCallbacks
): Promise<void> {
    const listTitle = action.type === "CHANGE_VAR" ? ctx.getOpenContainerTitle() : null;
    ctx.getMenuItemSlot("Add Action").click();
    await timedWaitForMenu(ctx, "menuClickWait");

    const spec = getActionIo(action.type);
    const displayName = spec.displayName;

    await clickAddActionOption(ctx, action.type, displayName, callbacks);
    if (!spec.write) {
        callbacks?.onActionAdded?.();
    }

    if (spec.write) {
        // Checkpoint the new list entry while the add confirmation/editor still
        // identifies our addition, before the Holder click can fail. A recovery
        // read must never establish ownership from whichever entry is now there.
        const identity =
            action.type === "CHANGE_VAR" && action.holder.type === "Team"
                ? await captureNewChangeVar(ctx, listLength, listTitle)
                : undefined;
        try {
            await writeOpenAction(ctx, action, { resolveItem, apply });
        } catch (error) {
            // Never delete an incomplete parent from its child-type summary:
            // another editor's child value changes are invisible there. Propagate
            // the failure so the next live replan repairs that same container.
            if (
                action.type !== "CHANGE_VAR" ||
                action.holder.type !== "Team" ||
                !(error instanceof CycleFieldReadError) ||
                error.slotName !== "Holder" ||
                ctx.tryGetMenuItemSlot("Team") === null ||
                identity === undefined
            )
                throw error;

            // The action exists and the cycle was sent. Never add another action
            // or click the malformed skull. Reopen the appended list entry.
            await recoverNewChangeVar(ctx, action, resolveItem, apply, identity, error);
        }
        callbacks?.onActionAdded?.();
        await clickGoBack(ctx);
    }

    await setNoteOnLastVisibleSlot(ctx, action.note);
}

function baseTitle(title: string | null): string {
    return (title ?? "").replace(/^\(\d+\/\d+\)\s+/, "");
}

async function readNewActionSlot(
    ctx: TaskContext,
    index: number,
    listTitle: string | null,
    displayName: string
) {
    if (
        listTitle === null ||
        baseTitle(ctx.getOpenContainerTitle()) !== baseTitle(listTitle)
    ) {
        throw new Error(`Cannot identify the action list for ${displayName} recovery.`);
    }
    const slot = await getPaginatedListSlotAtIndex(
        ctx,
        index,
        index + 1,
        ACTION_LIST_CONFIG
    );
    const title = ctx.getOpenContainerTitle() ?? "";
    const page = parsePaginatedTitlePage(title, ACTION_LIST_CONFIG);
    const slots = getVisiblePaginatedItemSlots(ctx);
    const expectedPage = Math.floor(index / 21) + 1;
    if (
        baseTitle(title) !== baseTitle(listTitle) ||
        (page?.currentPage ?? 1) !== expectedPage ||
        (page?.totalPages ?? 1) !== expectedPage ||
        slots.length !== (index % 21) + 1 ||
        removedFormatting(slot.getItem().getName()) !== displayName
    )
        throw new Error(
            `Cannot identify the newly added ${displayName} action for Holder recovery.`
        );
    return slot;
}

function newActionIdentity(
    ctx: TaskContext,
    index: number,
    listTitle: string | null,
    displayName: string,
    checkpoint: { title: string | null; slotId: number; name: string; lore: string[] }
) {
    const read = async () => {
        const slot = await readNewActionSlot(ctx, index, listTitle, displayName);
        if (
            ctx.getOpenContainerTitle() !== checkpoint.title ||
            slot.getSlotId() !== checkpoint.slotId ||
            slot.getItem().getName() !== checkpoint.name ||
            JSON.stringify(itemLore(slot.getItem())) !== JSON.stringify(checkpoint.lore)
        ) {
            throw new Error(
                `The newly added ${displayName} action changed during Holder recovery.`
            );
        }
        return slot;
    };

    return {
        read,
        async remove() {
            const slot = await read();
            slot.click(MouseButton.RIGHT);
            await timedWaitForMenu(ctx, "menuClickWait");
            const remainingPage = Math.max(1, Math.ceil(index / 21));
            await goToPaginatedListPage(ctx, remainingPage, ACTION_LIST_CONFIG);
            const remainingSlots = getVisiblePaginatedItemSlots(ctx);
            const expectedVisible = index === 0 ? 0 : ((index - 1) % 21) + 1;
            const visibleCount = remainingSlots.filter(
                (item) =>
                    removedFormatting(item.getItem().getName()) !==
                    ACTION_LIST_CONFIG.emptyPlaceholderName
            ).length;
            const remainingTitle = ctx.getOpenContainerTitle() ?? "";
            const remainingState = parsePaginatedTitlePage(
                remainingTitle,
                ACTION_LIST_CONFIG
            );
            if (
                visibleCount !== expectedVisible ||
                (remainingState?.totalPages ?? 1) !== remainingPage ||
                baseTitle(remainingTitle) !== baseTitle(listTitle)
            ) {
                throw new Error(
                    `Holder recovery exhausted; removal of the newly added ${displayName} action was not confirmed.`
                );
            }
        },
    };
}

async function captureNewChangeVar(
    ctx: TaskContext,
    index: number,
    listTitle: string | null
) {
    if (ctx.getOpenContainerTitle() !== "Action Settings") {
        throw new Error("Cannot checkpoint the newly added Change Variable editor.");
    }
    await clickGoBack(ctx);
    const slot = await readNewActionSlot(ctx, index, listTitle, "Change Variable");
    const lore = itemLore(slot.getItem());
    const holderLines = lore.filter(
        (line) => removedFormatting(line) === "Holder: Player"
    );
    if (
        holderLines.length !== 1 ||
        lore.some((line) => removedFormatting(line).indexOf("Team:") === 0)
    ) {
        throw new Error(
            "Cannot checkpoint the newly added Player Change Variable action."
        );
    }
    // Only the impending Player -> Team click may change this full list lore.
    // Preserve formatting, values, note and footer exactly. Unexpected server
    // formatting is refused rather than learning a new identity after failure.
    const expectedLore: string[] = [];
    for (const line of lore) {
        if (line === holderLines[0]) {
            expectedLore.push(line.replace(/Player$/, "Team"));
            expectedLore.push(
                line.replace("Holder:", "Team:").replace(/Player$/, "None")
            );
        } else expectedLore.push(line);
    }
    const identity = newActionIdentity(ctx, index, listTitle, "Change Variable", {
        title: ctx.getOpenContainerTitle(),
        slotId: slot.getSlotId(),
        name: slot.getItem().getName(),
        lore: expectedLore,
    });
    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    if (ctx.getOpenContainerTitle() !== "Action Settings") {
        throw new Error("Cannot reopen the checkpointed Change Variable editor.");
    }
    return identity;
}

async function recoverNewChangeVar(
    ctx: TaskContext,
    action: Extract<Action, { type: "CHANGE_VAR" }>,
    resolveItem: ResolveItemField,
    apply: ActionApplyContext,
    identity: ReturnType<typeof newActionIdentity>,
    originalError: Error
): Promise<void> {
    try {
        const listSlot = async () => {
            if (ctx.getOpenContainerTitle() !== "Action Settings") throw originalError;
            await clickGoBack(ctx);
            return identity.read();
        };

        for (let attempt = 0; attempt < 3; attempt++) {
            const slot = await listSlot();
            slot.click();
            await timedWaitForMenu(ctx, "menuClickWait");
            try {
                // setCycleValue reads Holder again and confirms the selected value
                // before the writer can proceed to Team, key, operation and value.
                await writeOpenAction(ctx, action, { resolveItem, apply });
                return;
            } catch (error) {
                if (isTaskCancelled(error)) throw error;
                if (
                    !/Could not find "Holder" in "Action Settings"/.test(
                        errorMessage(error)
                    )
                )
                    throw error;
            }
        }

        await clickGoBack(ctx);
        await identity.remove();
        throw new Error(
            "Holder recovery exhausted after 3 reopens; removed the newly added Change Variable action."
        );
    } catch (error) {
        if (isTaskCancelled(error)) throw error;
        // Refusals, failed removal checks and disconnects must retain the menu
        // diagnostic so an idle healthy bot is not blamed for a layout failure.
        throw new Error(`${originalError.message}; ${errorMessage(error)}`);
    }
}

export async function appendActionsToOpenActionList(
    ctx: TaskContext,
    desired: Action[],
    resolveItem: ResolveItemField
): Promise<void> {
    assertOneLevelActionTree(desired);
    const apply: ActionApplyContext = {
        markHeaderApplied: () => undefined,
        shouldApplyList: () => true,

        async applyChildActions(_prop, args) {
            await appendChildActionsToOpenActionList(ctx, args.desired, resolveItem);
        },

        async applyConditions(_prop, args) {
            await appendConditionsToOpenConditionList(ctx, args.desired, resolveItem);
        },
    };
    const existing = await readPaginatedList(ctx, ACTION_LIST_CONFIG, async () =>
        getVisiblePaginatedItemSlots(ctx)
            .filter((slot) => !isEmptyPaginatedPlaceholder(slot, ACTION_LIST_CONFIG))
            .map((_slot, index) => ({ index }))
    );
    for (let i = 0; i < desired.length; i++) {
        await addAction(ctx, desired[i], resolveItem, apply, existing.length + i);
    }
    if (desired.length > 0) {
        await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    }
}

async function appendChildActionsToOpenActionList(
    ctx: TaskContext,
    desired: Action[],
    resolveItem: ResolveItemField
): Promise<void> {
    const children: ChildAction[] = [];
    for (const action of desired) {
        if (!isChildAction(action)) {
            throw new Error(
                `${action.type} action cannot appear inside an action child list.`
            );
        }
        children.push(action);
    }

    const apply: ActionApplyContext = {
        markHeaderApplied: () => undefined,
        shouldApplyList: () => true,
        async applyChildActions() {
            throw new Error(
                "An action child list cannot contain another action container."
            );
        },
        async applyConditions(_prop, args) {
            await appendConditionsToOpenConditionList(ctx, args.desired, resolveItem);
        },
    };

    for (let i = 0; i < children.length; i++) {
        await addAction(ctx, children[i], resolveItem, apply, i);
    }
    if (children.length > 0) {
        await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    }
}

export async function deleteObservedAction(
    ctx: TaskContext,
    index: number,
    listLength: number,
    callbacks?: MutationCallbacks
): Promise<void> {
    const slot = await getPaginatedListSlotAtIndex(
        ctx,
        index,
        listLength,
        ACTION_LIST_CONFIG
    );
    callbacks?.onMutationStarted?.();
    slot.click(MouseButton.RIGHT);
    await timedWaitForMenu(ctx, "menuClickWait");
}

export async function moveActionToIndex(
    ctx: TaskContext,
    fromIndex: number,
    toIndex: number,
    listLength: number,
    callbacks?: MutationCallbacks
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

        const currentSlot = await getPaginatedListSlotAtIndex(
            ctx,
            currentIndex,
            listLength,
            ACTION_LIST_CONFIG
        );
        callbacks?.onMutationStarted?.();
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
    displayName: string,
    callbacks?: ImportActionCallbacks
): Promise<void> {
    const slot = await getSlotPaginate(ctx, displayName);

    if (isLimitExceeded(slot, "action")) {
        throw Diagnostic.error(`Maximum amount of ${displayName} actions exceeded`);
    }

    const wait = timedWaitForMenu(ctx, "menuClickWait");
    callbacks?.onMutationStarted?.();
    slot.click();
    try {
        await wait;
    } catch (error) {
        if (isTaskCancelled(error)) throw error;
        throw new Error(
            `After clicking Add Action option "${displayName}" (${actionType})${menuStateDescription()}: ${errorMessage(error)}`
        );
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
