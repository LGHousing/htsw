import type {
    Action,
    ActionActionBar,
    ActionApplyInventoryLayout,
    ActionApplyPotionEffect,
    ActionChangeHealth,
    ActionChangeHunger,
    ActionChangeMaxHealth,
    ActionChangeVar,
    ActionConditional,
    ActionDropItem,
    ActionFailParkour,
    ActionFunction,
    ActionGiveExperienceLevels,
    ActionGiveItem,
    ActionLaunch,
    ActionSendMessage,
    ActionPauseExecution,
    ActionPlaySound,
    ActionRandom,
    ActionRemoveItem,
    ActionSetCompassTarget,
    ActionSetGamemode,
    ActionSetGroup,
    ActionSetTeam,
    ActionSetPlayerTime,
    ActionSetPlayerWeather,
    ActionToggleNametagDisplay,
    ActionSetVelocity,
    ActionSendToLobby,
    ActionTeleport,
    ActionTitle,
    ActionEnchantHeldItem,
    ActionDisplayMenu,
    Condition,
} from "htsw/types";

import TaskContext from "../tasks/context";
import {
    clickGoBack,
    waitForMenu,
    getSlotPaginate,
    setStringValue,
    setBooleanValue,
    setSelectValue,
    setCycleValue,
    readBooleanValue,
    setListItemNote,
    parseLoreKeyValueLine,
} from "./helpers";
import { ItemSlot, MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import { Diagnostic } from "htsw";
import { readConditionList, syncConditionList } from "./conditions";
import { normalizeActionCompare } from "./compare";
import {
    ACTION_MAPPINGS,
    getNestedListFields,
    parseActionListItem,
    tryGetActionTypeFromDisplayName,
} from "./actionMappings";
import { diffActionList } from "./actions/diff";
import type {
    ActionListDiff,
    ActionListOperation,
    NestedListProp,
    NestedPropsToRead,
    Observed,
    ObservedActionSlot,
} from "./actions/types";

export { diffActionList };
export type {
    ActionListDiff,
    ActionListOperation,
    NestedListProp,
    NestedPropsToRead,
    ObservedActionSlot as ObservedAction,
} from "./actions/types";

// Shape of Actions
type ActionSpec<T extends Action = Action> = {
    displayName: string;
    read?: (ctx: TaskContext, propsToRead: NestedPropsToRead) => Promise<Observed<T>>;
    write?: (ctx: TaskContext, desired: T, current?: Observed<T>) => Promise<void>;
};

type ActionSpecMap = {
    [K in Action["type"]]: ActionSpec<Extract<Action, { type: K }>>;
};

// Getter for the generic importAction function to get
// the correct spec with type safety (annoying runtime thing)
function getActionSpec<T extends Action["type"]>(
    type: T
): ActionSpec<Extract<Action, { type: T }>> {
    return ACTION_SPECS[type] as ActionSpec<Extract<Action, { type: T }>>;
}

function isLimitExceeded(slot: ItemSlot): boolean {
    const lore = slot.getItem().getLore();
    if (lore.length === 0) return false;
    const lastLine = lore[lore.length - 1];
    return removedFormatting(lastLine) === "You can't have more of this action!";
}

function getAllActionItemSlots(ctx: TaskContext): ItemSlot[] {
    const slots = ctx.getAllItemSlots((slot) => {
        const slotId = slot.getSlotId();
        const row = Math.floor(slotId / 9);
        const col = slotId % 9;
        return row >= 1 && row <= 3 && col >= 1 && col <= 7;
    });
    if (slots === null) {
        throw new Error("No open container found");
    }
    return slots;
}

async function readOpenConditional(
    ctx: TaskContext,
    propsToRead: NestedPropsToRead
): Promise<Observed<ActionConditional>> {
    let conditions: (Condition | null)[] = [];
    if (propsToRead.has("conditions")) {
        ctx.getItemSlot("Conditions").click();
        await waitForMenu(ctx);
        conditions = (await readConditionList(ctx)).map((entry) => entry.condition);
        await clickGoBack(ctx);
    }

    const matchAny = readBooleanValue(ctx.getItemSlot("Match Any Condition")) ?? false;

    const ifActions: (Observed<Action> | null)[] = [];
    if (propsToRead.has("ifActions")) {
        ctx.getItemSlot("If Actions").click();
        await waitForMenu(ctx);
        for (const entry of await readActionList(ctx)) {
            ifActions.push(entry.action);
        }
        await clickGoBack(ctx);
    }

    const elseActions: (Observed<Action> | null)[] = [];
    if (propsToRead.has("elseActions")) {
        ctx.getItemSlot("Else Actions").click();
        await waitForMenu(ctx);
        for (const entry of await readActionList(ctx)) {
            elseActions.push(entry.action);
        }
        await clickGoBack(ctx);
    }

    return {
        type: "CONDITIONAL",
        matchAny,
        conditions,
        ifActions,
        elseActions,
    };
}

async function writeConditional(
    ctx: TaskContext,
    action: ActionConditional
): Promise<void> {
    if (action.conditions.length > 0) {
        ctx.getItemSlot("Conditions").click();
        await waitForMenu(ctx);

        await syncConditionList(ctx, action.conditions);
        await clickGoBack(ctx);

        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Match Any Condition"),
            action.matchAny
        );
    }

    if (action.ifActions.length > 0) {
        ctx.getItemSlot("If Actions").click();
        await waitForMenu(ctx);
        await syncActionList(ctx, action.ifActions);
        await clickGoBack(ctx);
    }

    if (action.elseActions.length > 0) {
        ctx.getItemSlot("Else Actions").click();
        await waitForMenu(ctx);
        await syncActionList(ctx, action.elseActions);
        await clickGoBack(ctx);
    }
}

async function writeSetGroup(ctx: TaskContext, action: ActionSetGroup): Promise<void> {}

async function writeTitle(ctx: TaskContext, action: ActionTitle): Promise<void> {}

async function writeActionBar(ctx: TaskContext, action: ActionActionBar): Promise<void> {}

async function writeChangeMaxHealth(
    ctx: TaskContext,
    action: ActionChangeMaxHealth
): Promise<void> {}

async function writeGiveItem(ctx: TaskContext, action: ActionGiveItem): Promise<void> {}

async function writeRemoveItem(
    ctx: TaskContext,
    action: ActionRemoveItem
): Promise<void> {}

async function writeSendMessage(
    ctx: TaskContext,
    action: ActionSendMessage
): Promise<void> {
    await setStringValue(ctx, ctx.getItemSlot("Message"), action.message);
}

async function writeApplyPotionEffect(
    ctx: TaskContext,
    action: ActionApplyPotionEffect
): Promise<void> {}

async function writeGiveExperienceLevels(
    ctx: TaskContext,
    action: ActionGiveExperienceLevels
): Promise<void> {}

async function writeSendToLobby(
    ctx: TaskContext,
    action: ActionSendToLobby
): Promise<void> {}

const VAR_HOLDER_OPTIONS = ["Player", "Global", "Team"] as const;

async function writeChangeVar(ctx: TaskContext, action: ActionChangeVar): Promise<void> {
    if (action.holder) {
        await setCycleValue(ctx, "Holder", VAR_HOLDER_OPTIONS, action.holder.type);
    }

    if (action.key) {
        await setStringValue(ctx, ctx.getItemSlot("Variable"), action.key);
    }

    if (action.op) {
        await setSelectValue(ctx, "Operation", action.op);
    }

    if (action.value) {
        await setStringValue(ctx, ctx.getItemSlot("Value"), action.value);
    }

    if (action.unset !== undefined) {
        await setBooleanValue(ctx, ctx.getItemSlot("Automatic Unset"), action.unset);
    }
}

async function writeTeleport(ctx: TaskContext, action: ActionTeleport): Promise<void> {}

async function writeFailParkour(
    ctx: TaskContext,
    action: ActionFailParkour
): Promise<void> {}

async function writePlaySound(ctx: TaskContext, action: ActionPlaySound): Promise<void> {}

async function writeSetCompassTarget(
    ctx: TaskContext,
    action: ActionSetCompassTarget
): Promise<void> {}

async function writeSetGamemode(
    ctx: TaskContext,
    action: ActionSetGamemode
): Promise<void> {}

async function writeChangeHealth(
    ctx: TaskContext,
    action: ActionChangeHealth
): Promise<void> {}

async function writeChangeHunger(
    ctx: TaskContext,
    action: ActionChangeHunger
): Promise<void> {}

async function readOpenRandom(
    ctx: TaskContext,
    propsToRead: NestedPropsToRead
): Promise<Observed<ActionRandom>> {
    const actions: (Observed<Action> | null)[] = [];
    ctx.getItemSlot("Actions").click();
    await waitForMenu(ctx);
    for (const entry of await readActionList(ctx)) {
        actions.push(entry.action);
    }
    await clickGoBack(ctx);
    return {
        type: "RANDOM",
        actions,
    };
}

async function writeRandom(ctx: TaskContext, action: ActionRandom): Promise<void> {
    if (action.actions.length === 0) return;

    ctx.getItemSlot("Actions").click();
    await waitForMenu(ctx);
    await syncActionList(ctx, action.actions);
    await clickGoBack(ctx);
}

async function writeFunction(ctx: TaskContext, action: ActionFunction): Promise<void> {}

async function writeApplyInventoryLayout(
    ctx: TaskContext,
    action: ActionApplyInventoryLayout
): Promise<void> {}

async function writeEnchantHeldItem(
    ctx: TaskContext,
    action: ActionEnchantHeldItem
): Promise<void> {}

async function writePause(
    ctx: TaskContext,
    action: ActionPauseExecution
): Promise<void> {}

async function writeSetTeam(ctx: TaskContext, action: ActionSetTeam): Promise<void> {}

async function writeDisplayMenu(
    ctx: TaskContext,
    action: ActionDisplayMenu
): Promise<void> {}

async function writeDropItem(ctx: TaskContext, action: ActionDropItem): Promise<void> {}

async function writeSetVelocity(
    ctx: TaskContext,
    action: ActionSetVelocity
): Promise<void> {}

async function writeLaunch(ctx: TaskContext, action: ActionLaunch): Promise<void> {}

async function writeSetPlayerWeather(
    ctx: TaskContext,
    action: ActionSetPlayerWeather
): Promise<void> {}

async function writeSetPlayerTime(
    ctx: TaskContext,
    action: ActionSetPlayerTime
): Promise<void> {}

async function writeToggleNametagDisplay(
    ctx: TaskContext,
    action: ActionToggleNametagDisplay
): Promise<void> {}

const ACTION_SPECS = {
    CONDITIONAL: {
        displayName: ACTION_MAPPINGS.CONDITIONAL.displayName,
        read: readOpenConditional,
        write: writeConditional,
    },
    SET_GROUP: {
        displayName: ACTION_MAPPINGS.SET_GROUP.displayName,
        write: writeSetGroup,
    },
    KILL: {
        displayName: ACTION_MAPPINGS.KILL.displayName,
    },
    HEAL: {
        displayName: ACTION_MAPPINGS.HEAL.displayName,
    },
    TITLE: {
        displayName: ACTION_MAPPINGS.TITLE.displayName,
        write: writeTitle,
    },
    ACTION_BAR: {
        displayName: ACTION_MAPPINGS.ACTION_BAR.displayName,
        write: writeActionBar,
    },
    RESET_INVENTORY: {
        displayName: ACTION_MAPPINGS.RESET_INVENTORY.displayName,
    },
    CHANGE_MAX_HEALTH: {
        displayName: ACTION_MAPPINGS.CHANGE_MAX_HEALTH.displayName,
        write: writeChangeMaxHealth,
    },
    PARKOUR_CHECKPOINT: {
        displayName: ACTION_MAPPINGS.PARKOUR_CHECKPOINT.displayName,
    },
    GIVE_ITEM: {
        displayName: ACTION_MAPPINGS.GIVE_ITEM.displayName,
        write: writeGiveItem,
    },
    REMOVE_ITEM: {
        displayName: ACTION_MAPPINGS.REMOVE_ITEM.displayName,
        write: writeRemoveItem,
    },
    MESSAGE: {
        displayName: ACTION_MAPPINGS.MESSAGE.displayName,
        write: writeSendMessage,
    },
    APPLY_POTION_EFFECT: {
        displayName: ACTION_MAPPINGS.APPLY_POTION_EFFECT.displayName,
        write: writeApplyPotionEffect,
    },
    CLEAR_POTION_EFFECTS: {
        displayName: ACTION_MAPPINGS.CLEAR_POTION_EFFECTS.displayName,
    },
    GIVE_EXPERIENCE_LEVELS: {
        displayName: ACTION_MAPPINGS.GIVE_EXPERIENCE_LEVELS.displayName,
        write: writeGiveExperienceLevels,
    },
    SEND_TO_LOBBY: {
        displayName: ACTION_MAPPINGS.SEND_TO_LOBBY.displayName,
        write: writeSendToLobby,
    },
    CHANGE_VAR: {
        displayName: ACTION_MAPPINGS.CHANGE_VAR.displayName,
        write: writeChangeVar,
    },
    TELEPORT: {
        displayName: ACTION_MAPPINGS.TELEPORT.displayName,
        write: writeTeleport,
    },
    FAIL_PARKOUR: {
        displayName: ACTION_MAPPINGS.FAIL_PARKOUR.displayName,
        write: writeFailParkour,
    },
    PLAY_SOUND: {
        displayName: ACTION_MAPPINGS.PLAY_SOUND.displayName,
        write: writePlaySound,
    },
    SET_COMPASS_TARGET: {
        displayName: ACTION_MAPPINGS.SET_COMPASS_TARGET.displayName,
        write: writeSetCompassTarget,
    },
    SET_GAMEMODE: {
        displayName: ACTION_MAPPINGS.SET_GAMEMODE.displayName,
        write: writeSetGamemode,
    },
    CHANGE_HEALTH: {
        displayName: ACTION_MAPPINGS.CHANGE_HEALTH.displayName,
        write: writeChangeHealth,
    },
    CHANGE_HUNGER: {
        displayName: ACTION_MAPPINGS.CHANGE_HUNGER.displayName,
        write: writeChangeHunger,
    },
    RANDOM: {
        displayName: ACTION_MAPPINGS.RANDOM.displayName,
        read: readOpenRandom,
        write: writeRandom,
    },
    FUNCTION: {
        displayName: ACTION_MAPPINGS.FUNCTION.displayName,
        write: writeFunction,
    },
    APPLY_INVENTORY_LAYOUT: {
        displayName: ACTION_MAPPINGS.APPLY_INVENTORY_LAYOUT.displayName,
        write: writeApplyInventoryLayout,
    },
    ENCHANT_HELD_ITEM: {
        displayName: ACTION_MAPPINGS.ENCHANT_HELD_ITEM.displayName,
        write: writeEnchantHeldItem,
    },
    PAUSE: {
        displayName: ACTION_MAPPINGS.PAUSE.displayName,
        write: writePause,
    },
    SET_TEAM: {
        displayName: ACTION_MAPPINGS.SET_TEAM.displayName,
        write: writeSetTeam,
    },
    SET_MENU: {
        displayName: ACTION_MAPPINGS.SET_MENU.displayName,
        write: writeDisplayMenu,
    },
    CLOSE_MENU: {
        displayName: ACTION_MAPPINGS.CLOSE_MENU.displayName,
    },
    DROP_ITEM: {
        displayName: ACTION_MAPPINGS.DROP_ITEM.displayName,
        write: writeDropItem,
    },
    SET_VELOCITY: {
        displayName: ACTION_MAPPINGS.SET_VELOCITY.displayName,
        write: writeSetVelocity,
    },
    LAUNCH: {
        displayName: ACTION_MAPPINGS.LAUNCH.displayName,
        write: writeLaunch,
    },
    SET_PLAYER_WEATHER: {
        displayName: ACTION_MAPPINGS.SET_PLAYER_WEATHER.displayName,
        write: writeSetPlayerWeather,
    },
    SET_PLAYER_TIME: {
        displayName: ACTION_MAPPINGS.SET_PLAYER_TIME.displayName,
        write: writeSetPlayerTime,
    },
    TOGGLE_NAMETAG_DISPLAY: {
        displayName: ACTION_MAPPINGS.TOGGLE_NAMETAG_DISPLAY.displayName,
        write: writeToggleNametagDisplay,
    },
    USE_HELD_ITEM: {
        displayName: ACTION_MAPPINGS.USE_HELD_ITEM.displayName,
    },
    EXIT: {
        displayName: ACTION_MAPPINGS.EXIT.displayName,
    },
    CANCEL_EVENT: {
        displayName: ACTION_MAPPINGS.CANCEL_EVENT.displayName,
    },
} satisfies ActionSpecMap;

/**
 * Checks nested-list lore fields for "None" markers, fills empty ones
 * with `[]`, and returns the set of nested props that still need reading.
 */
function nonEmptyNestedListProps(
    action: Observed<Action>,
    slot: ItemSlot
): NestedPropsToRead {
    const nestedFields = getNestedListFields(action.type);
    const lore = slot.getItem().getLore();
    const toRead: NestedPropsToRead = new Set();

    // Nested list lore uses two lines:
    //   Label:
    //    - None
    // Find the label line, then check if the next line is "- None".
    for (const { label, prop } of nestedFields) {
        let isEmpty = false;
        for (let i = 0; i < lore.length - 1; i++) {
            const lineText = removedFormatting(lore[i]).trim();
            if (lineText === label + ":") {
                const nextLineText = removedFormatting(lore[i + 1]).trim();
                isEmpty = nextLineText === "- None";
                break;
            }
        }

        if (isEmpty) {
            Object.assign(action, { [prop]: [] });
        } else {
            toRead.add(prop as NestedListProp);
        }
    }

    return toRead;
}

export async function readActionsListPage(
    ctx: TaskContext
): Promise<ObservedActionSlot[]> {
    const slots = getAllActionItemSlots(ctx);
    if (slots === null) {
        throw new Error("No open container found");
    }

    const observed: ObservedActionSlot[] = slots
        .map((slot) => ({
            slot,
            type: tryGetActionTypeFromDisplayName(slot.getItem().getName()),
        }))

        .map((entry, index) => {
            const observed: ObservedActionSlot = {
                index,
                slotId: entry.slot.getSlotId(),
                slot: entry.slot,
                action: null,
            };
            if (!entry.type) {
                return observed;
            }

            const action = parseActionListItem(entry.slot, entry.type);

            observed.action = action;
            return observed;
        });

    // Actions with non-empty nested lists need clicking in to read.
    for (const entry of observed) {
        if (entry.action === null) continue;
        const propsToRead = nonEmptyNestedListProps(entry.action, entry.slot);
        if (!propsToRead) continue;

        // preserve note
        const note = entry.action.note;
        try {
            entry.slot.click();
            await waitForMenu(ctx);
            const spec = getActionSpec(entry.action.type);
            if (!spec.read) {
                throw new Error(
                    `Reading action "${entry.action.type}" is not implemented.`
                );
            }
            // Read nested list action data
            entry.action = await spec.read(ctx, propsToRead);
            if (note) {
                entry.action.note = note;
            }
            await clickGoBack(ctx);
        } catch {
            if (ctx.tryGetItemSlot("Go Back") !== null) {
                await clickGoBack(ctx);
            }
        }
    }

    return observed;
}

export async function readActionList(ctx: TaskContext): Promise<ObservedActionSlot[]> {
    let pages = 0;
    const observed: ObservedActionSlot[] = [];
    while (true) {
        pages += 1;
        const pageObserved = await readActionsListPage(ctx);
        observed.push(...pageObserved);

        const nextPageSlot = ctx.tryGetItemSlot((slot) => slot.getSlotId() === 53);
        if (nextPageSlot === null) {
            break;
        }

        nextPageSlot.click();
        await waitForMenu(ctx);
    }
    for (let i = 0; i < pages - 1; i++) {
        // previous page arrow
        ctx.getItemSlot((slot) => slot.getSlotId() === 45).click();
        await waitForMenu(ctx);
    }
    return observed;
}

async function writeOpenAction(
    ctx: TaskContext,
    desired: Action,
    current?: Observed<Action>
): Promise<void> {
    const spec = getActionSpec(desired.type);
    // When adding new actions, read the current values to avoid
    // unnecessarily overwriting fields that aren't changing.
    let resolvedCurrent = current;

    if (resolvedCurrent === undefined && spec.read) {
        resolvedCurrent = await spec.read(ctx, new Set());
    }

    if (!spec.write) {
        throw new Error(`Writing action "${desired.type}" is not implemented.`);
    }

    await spec.write(ctx, desired, resolvedCurrent);
}

async function deleteObservedAction(
    observed: ObservedActionSlot,
    ctx: TaskContext
): Promise<void> {
    const currentType = tryGetActionTypeFromDisplayName(
        observed.slot.getItem().getName()
    );
    if (currentType !== observed.action?.type) {
        throw new Error("Observed action type does not match slot display.");
    }
    observed.slot.click(MouseButton.RIGHT);
    await waitForMenu(ctx);
}

async function moveActionToIndex(
    ctx: TaskContext,
    fromIndex: number,
    toIndex: number
): Promise<void> {
    const itemSlots = getAllActionItemSlots(ctx);
    const listLength = itemSlots.length;

    const targetIndex = ((toIndex % listLength) + listLength) % listLength;
    let currentIndex = ((fromIndex % listLength) + listLength) % listLength;

    for (let attempt = 0; attempt < 128 && currentIndex !== targetIndex; attempt++) {
        const rightDistance = (targetIndex - currentIndex + listLength) % listLength;
        const leftDistance = (currentIndex - targetIndex + listLength) % listLength;
        const button =
            leftDistance <= rightDistance ? MouseButton.LEFT : MouseButton.RIGHT;

        // Re-read slots each iteration — the slot refs shift after each swap.
        const currentSlots = getAllActionItemSlots(ctx);
        currentSlots[currentIndex].click(button, true);
        await waitForMenu(ctx);

        if (button === MouseButton.LEFT) {
            currentIndex = (currentIndex - 1 + listLength) % listLength;
        } else {
            currentIndex = (currentIndex + 1) % listLength;
        }
    }
}

export async function importAction(ctx: TaskContext, action: Action): Promise<void> {
    ctx.getItemSlot("Add Action").click();
    await waitForMenu(ctx);

    const spec = getActionSpec(action.type);
    const displayName = spec.displayName;

    const slot = await getSlotPaginate(ctx, displayName);

    if (isLimitExceeded(slot)) {
        throw Diagnostic.error(`Maximum amount of ${displayName} actions exceeded`);
    }

    slot.click();
    await waitForMenu(ctx);

    // No-field actions (e.g. Kill Player, Exit) add directly to the list
    // without opening an editor.
    if (spec.write) {
        await writeOpenAction(ctx, action);
        await clickGoBack(ctx);
    }

    if (action.note) {
        const itemSlots = getAllActionItemSlots(ctx);
        const addedSlot = itemSlots[itemSlots.length - 1];
        if (addedSlot) {
            await setListItemNote(ctx, addedSlot, action.note);
        }
    }
}

async function applyActionListDiff(
    ctx: TaskContext,
    observed: ObservedActionSlot[],
    diff: ActionListDiff
): Promise<void> {
    if (diff.operations.length === 0) return;

    const deletes: Array<ActionListOperation & { kind: "delete" }> = [];
    const edits: Array<ActionListOperation & { kind: "edit" }> = [];
    const moves: Array<ActionListOperation & { kind: "move" }> = [];
    const adds: Array<ActionListOperation & { kind: "add" }> = [];

    for (const op of diff.operations) {
        switch (op.kind) {
            case "delete":
                deletes.push(op);
                break;
            case "edit":
                edits.push(op);
                break;
            case "move":
                moves.push(op);
                break;
            case "add":
                adds.push(op);
                break;
        }
    }

    // Deletes first (reverse order so indices stay valid), then refresh slot refs.
    if (deletes.length > 0) {
        deletes.sort((a, b) => b.observed.index - a.observed.index);
        for (const op of deletes) {
            await deleteObservedAction(op.observed, ctx);
        }

        const deletedIndices = new Set(deletes.map((op) => op.observed.index));
        const freshSlots = (ctx.getAllItemSlots() ?? []).filter(
            (slot) =>
                tryGetActionTypeFromDisplayName(slot.getItem().getName()) !== undefined
        );
        const remaining = observed.filter((o) => !deletedIndices.has(o.index));
        for (let i = 0; i < remaining.length && i < freshSlots.length; i++) {
            remaining[i].slot = freshSlots[i];
            remaining[i].slotId = freshSlots[i].getSlotId();
            remaining[i].index = i;
        }
    }

    const remainingObserved = observed.filter(
        (entry) => !deletes.some((op) => op.observed === entry)
    );

    // Edits before moves: edits use slot refs from readActionList which
    // become stale after moves shift actions around. Moves re-read slots
    // internally so they're unaffected by prior edits.
    for (const op of edits) {
        if (op.desired.note !== op.observed.action?.note) {
            await setListItemNote(ctx, op.observed.slot, op.desired.note);
            continue;
        }
        const spec = getActionSpec(op.desired.type);
        if (spec.write) {
            op.observed.slot.click();
            await waitForMenu(ctx);

            if (!op.observed.action) {
                throw new Error(
                    "Observed action should always be present for edit operations."
                );
            }

            await writeOpenAction(ctx, op.desired, op.observed.action);
            await clickGoBack(ctx);
        }

        await setListItemNote(ctx, op.observed.slot, op.desired.note);
    }

    moves.sort((a, b) => a.toIndex - b.toIndex);
    for (const op of moves) {
        const fromIndex = remainingObserved.indexOf(op.observed);
        if (fromIndex === -1) {
            continue;
        }

        await moveActionToIndex(ctx, fromIndex, op.toIndex);

        remainingObserved.splice(fromIndex, 1);
        remainingObserved.splice(op.toIndex, 0, op.observed);
    }

    adds.sort((a, b) => a.toIndex - b.toIndex);
    for (const op of adds) {
        await importAction(ctx, op.desired);
        const lastIndex = getAllActionItemSlots(ctx).length - 1;
        await moveActionToIndex(ctx, lastIndex, op.toIndex);
    }
}

function logSyncState(ctx: TaskContext, diff: ActionListDiff): void {
    if (diff.operations.length === 0) {
        ctx.displayMessage(`&7[sync] &aUp to date.`);
        return;
    }

    ctx.displayMessage(`&7[sync] &d${diff.operations.length} operation(s):`);
    for (const op of diff.operations) {
        switch (op.kind) {
            case "delete":
                ctx.displayMessage(`&7  &c- ${op.observed.action?.type}`);
                break;
            case "edit":
                ctx.displayMessage(
                    `&7  &6~ ${op.observed.action?.type} &7-> &6${op.desired.type}`
                );
                break;
            case "add":
                ctx.displayMessage(`&7  &a+ ${op.desired.type} &7at ${op.toIndex}`);
                break;
            case "move":
                ctx.displayMessage(
                    `&7  &e> ${op.action.type} &7${op.observed.index} -> ${op.toIndex}`
                );
                break;
        }
    }
}

export async function syncActionList(ctx: TaskContext, desired: Action[]): Promise<void> {
    const observed = await readActionList(ctx);
    const diff = diffActionList(observed, desired);
    logSyncState(ctx, diff);
    await applyActionListDiff(ctx, observed, diff);
}
