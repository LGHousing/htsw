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
    normalizeNoteText,
    parseLoreKeyValueLine,
} from "./helpers";
import { ItemSlot, MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import { Diagnostic } from "htsw";
import { readConditionList, syncConditionList } from "./conditions";
import {
    ACTION_MAPPINGS,
    getActionDisplayName,
    isActionFullyReadableFromList,
    parseActionListItem,
    tryGetActionTypeFromDisplayName,
} from "./actionMappings";

// Shape of Actions
type ActionSpec<T extends Action = Action> = {
    displayName: string;
    read?: (ctx: TaskContext, emptyNestedProps?: Set<string>) => Promise<T>;
    write?: (ctx: TaskContext, desired: T, current?: T) => Promise<void>;
    hasNestedActionLists?: boolean;
};


type ActionSpecMap = {
    [K in Action["type"]]: ActionSpec<Extract<Action, { type: K }>>;
};

export type ActionListDiff = {
    operations: ActionListOperation[];
};

export type ActionListOperation =
    | { kind: "move"; fromIndex: number; toIndex: number; action: Action }
    | { kind: "edit"; observed: ObservedAction; desired: Action }
    | { kind: "add"; desired: Action; toIndex: number }
    | { kind: "delete"; observed: ObservedAction };


export type ObservedAction = {
    index: number;
    slotId: number;
    slot: ItemSlot;
    displayName: string;
    type?: Action["type"];
    action?: Action;
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
    return (
        removedFormatting(lastLine) === "You can't have more of this action!"
    );
}

//UNUSED (need write functions)
function normalizeOptionalBoolean(value: boolean | undefined): boolean {
    return value === true;
}

function displayNameForSlot(slot: ItemSlot): string {
    return removedFormatting(slot.getItem().getName()).trim();
}


function normalizeForActionCompare(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeForActionCompare(entry));
    }

    if (typeof value !== "object" || value === null) {
        return value;
    }

    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
        const fieldValue = (value as Record<string, unknown>)[key];
        if (fieldValue !== undefined) {
            normalized[key] =
                key === "note" && typeof fieldValue === "string"
                    ? normalizeNoteText(fieldValue)
                    : normalizeForActionCompare(fieldValue);
        }
    }

    return normalized;
}

export function actionsEqual(a: Action, b: Action): boolean {
    return (
        JSON.stringify(normalizeForActionCompare(a)) ===
        JSON.stringify(normalizeForActionCompare(b))
    );
}

export function sameActionType(a: Action, b: Action): boolean {
    return a.type === b.type;
}





async function readOpenConditional(
    ctx: TaskContext,
    emptyNestedProps?: Set<string>,
): Promise<ActionConditional> {
    let conditions: Condition[] = [];
    if (!emptyNestedProps || !emptyNestedProps.has("conditions")) {
        ctx.getItemSlot("Conditions").click();
        await waitForMenu(ctx);
        conditions = (await readConditionList(ctx)).map((entry) => entry.condition);
        await clickGoBack(ctx);
    }

    const matchAny =
        readBooleanValue(ctx.getItemSlot("Match Any Condition")) ?? false;

    const ifActions: Action[] = [];
    if (!emptyNestedProps || !emptyNestedProps.has("ifActions")) {
        ctx.getItemSlot("If Actions").click();
        await waitForMenu(ctx);
        for (const entry of await readActionList(ctx)) {
            if (entry.action) ifActions.push(entry.action);
        }
        await clickGoBack(ctx);
    }

    const elseActions: Action[] = [];
    if (!emptyNestedProps || !emptyNestedProps.has("elseActions")) {
        ctx.getItemSlot("Else Actions").click();
        await waitForMenu(ctx);
        for (const entry of await readActionList(ctx)) {
            if (entry.action) elseActions.push(entry.action);
        }
        await clickGoBack(ctx);
    }

    const action: ActionConditional = {
        type: "CONDITIONAL",
        matchAny,
        conditions,
        ifActions,
    };

    if (elseActions.length > 0) {
        action.elseActions = elseActions;
    }

    return action;
}

const VAR_HOLDER_OPTIONS = ["Player", "Global", "Team"] as const;

async function writeChangeVar(
    ctx: TaskContext,
    action: ActionChangeVar,
): Promise<void> {
    if (action.holder) {
        await setCycleValue(
            ctx,
            "Holder",
            VAR_HOLDER_OPTIONS,
            action.holder.type,
        );
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
        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Automatic Unset"),
            action.unset,
        );
    }
}

async function writeConditional(
    ctx: TaskContext,
    action: ActionConditional,
): Promise<void> {
    if (action.conditions.length > 0) {
        ctx.getItemSlot("Conditions").click();
        await waitForMenu(ctx);

        await syncConditionList(ctx, action.conditions);
        await clickGoBack(ctx);

        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Match Any Condition"),
            action.matchAny,
        );
    }

    if (action.ifActions && action.ifActions.length > 0) {
        ctx.getItemSlot("If Actions").click();
        await waitForMenu(ctx);
        await syncActionList(ctx, action.ifActions);
        await clickGoBack(ctx);
    }

    if (action.elseActions && action.elseActions.length > 0) {
        ctx.getItemSlot("Else Actions").click();
        await waitForMenu(ctx);
        await syncActionList(ctx, action.elseActions);
        await clickGoBack(ctx);
    }
}

async function writeSendMessage(
    ctx: TaskContext,
    action: ActionSendMessage,
): Promise<void> {
    await setStringValue(ctx, ctx.getItemSlot("Message"), action.message);
}

async function writeActionBar(
    ctx: TaskContext,
    action: ActionActionBar,
): Promise<void> {}

async function writePlaySound(
    ctx: TaskContext,
    action: ActionPlaySound,
): Promise<void> {}

async function writeGiveItem(
    ctx: TaskContext,
    action: ActionGiveItem,
): Promise<void> {}

async function writeTitle(
    ctx: TaskContext,
    action: ActionTitle,
): Promise<void> {}

async function writeSetGroup(
    ctx: TaskContext,
    action: ActionSetGroup,
): Promise<void> {}

async function writeRemoveItem(
    ctx: TaskContext,
    action: ActionRemoveItem,
): Promise<void> {}

async function writeApplyPotionEffect(
    ctx: TaskContext,
    action: ActionApplyPotionEffect,
): Promise<void> {}

async function writeDisplayMenu(
    ctx: TaskContext,
    action: ActionDisplayMenu,
): Promise<void> {}

async function writeSetPlayerWeather(
    ctx: TaskContext,
    action: ActionSetPlayerWeather,
): Promise<void> {}

async function writeSetPlayerTime(
    ctx: TaskContext,
    action: ActionSetPlayerTime,
): Promise<void> {}

async function writeToggleNametagDisplay(
    ctx: TaskContext,
    action: ActionToggleNametagDisplay,
): Promise<void> {}

async function writeSetTeam(
    ctx: TaskContext,
    action: ActionSetTeam,
): Promise<void> {}

async function writePause(
    ctx: TaskContext,
    action: ActionPauseExecution,
): Promise<void> {}

async function writeEnchantHeldItem(
    ctx: TaskContext,
    action: ActionEnchantHeldItem,
): Promise<void> {}

async function writeApplyInventoryLayout(
    ctx: TaskContext,
    action: ActionApplyInventoryLayout,
): Promise<void> {}

async function writeFunction(
    ctx: TaskContext,
    action: ActionFunction,
): Promise<void> {}

async function writeRandom(
    ctx: TaskContext,
    action: ActionRandom,
): Promise<void> {
    const actionsSlot =
        ctx.tryGetItemSlot("Actions") ?? ctx.tryGetItemSlot("Random Actions");
    if (actionsSlot === null) {
        throw new Error("Could not find Random Action nested actions list.");
    }

    actionsSlot.click();
    await waitForMenu(ctx);
    await syncActionList(ctx, action.actions);
    await clickGoBack(ctx);
}

async function writeSetGamemode(
    ctx: TaskContext,
    action: ActionSetGamemode,
): Promise<void> {}

async function writeSetCompassTarget(
    ctx: TaskContext,
    action: ActionSetCompassTarget,
): Promise<void> {}

async function writeFailParkour(
    ctx: TaskContext,
    action: ActionFailParkour,
): Promise<void> {}

async function writeTeleport(
    ctx: TaskContext,
    action: ActionTeleport,
): Promise<void> {}

async function writeSendToLobby(
    ctx: TaskContext,
    action: ActionSendToLobby,
): Promise<void> {}

async function writeGiveExperienceLevels(
    ctx: TaskContext,
    action: ActionGiveExperienceLevels,
): Promise<void> {}

async function writeChangeMaxHealth(
    ctx: TaskContext,
    action: ActionChangeMaxHealth,
): Promise<void> {}

async function writeChangeHealth(
    ctx: TaskContext,
    action: ActionChangeHealth,
): Promise<void> {}

async function writeChangeHunger(
    ctx: TaskContext,
    action: ActionChangeHunger,
): Promise<void> {}

async function writeDropItem(
    ctx: TaskContext,
    action: ActionDropItem,
): Promise<void> {}

async function writeSetVelocity(
    ctx: TaskContext,
    action: ActionSetVelocity,
): Promise<void> {}

async function writeLaunch(
    ctx: TaskContext,
    action: ActionLaunch,
): Promise<void> {}

const ACTION_SPECS = {
    CHANGE_VAR: {
        displayName: ACTION_MAPPINGS.CHANGE_VAR.displayName,
        write: writeChangeVar,
    },
    CONDITIONAL: {
        displayName: ACTION_MAPPINGS.CONDITIONAL.displayName,
        read: readOpenConditional,
        write: writeConditional,
        hasNestedActionLists: true,
    },
    MESSAGE: {
        displayName: ACTION_MAPPINGS.MESSAGE.displayName,
        write: writeSendMessage,
    },
    PLAY_SOUND: {
        displayName: ACTION_MAPPINGS.PLAY_SOUND.displayName,
        write: writePlaySound,
    },
    GIVE_ITEM: {
        displayName: ACTION_MAPPINGS.GIVE_ITEM.displayName,
        write: writeGiveItem,
    },
    TITLE: {
        displayName: ACTION_MAPPINGS.TITLE.displayName,
        write: writeTitle,
    },
    EXIT: {
        displayName: ACTION_MAPPINGS.EXIT.displayName,
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
    ACTION_BAR: {
        displayName: ACTION_MAPPINGS.ACTION_BAR.displayName,
        write: writeActionBar,
    },
    RESET_INVENTORY: {
        displayName: ACTION_MAPPINGS.RESET_INVENTORY.displayName,
    },
    REMOVE_ITEM: {
        displayName: ACTION_MAPPINGS.REMOVE_ITEM.displayName,
        write: writeRemoveItem,
    },
    APPLY_POTION_EFFECT: {
        displayName: ACTION_MAPPINGS.APPLY_POTION_EFFECT.displayName,
        write: writeApplyPotionEffect,
    },
    SET_MENU: {
        displayName: ACTION_MAPPINGS.SET_MENU.displayName,
        write: writeDisplayMenu,
    },
    CLOSE_MENU: {
        displayName: ACTION_MAPPINGS.CLOSE_MENU.displayName,
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
    SET_TEAM: {
        displayName: ACTION_MAPPINGS.SET_TEAM.displayName,
        write: writeSetTeam,
    },
    PAUSE: {
        displayName: ACTION_MAPPINGS.PAUSE.displayName,
        write: writePause,
    },
    ENCHANT_HELD_ITEM: {
        displayName: ACTION_MAPPINGS.ENCHANT_HELD_ITEM.displayName,
        write: writeEnchantHeldItem,
    },
    APPLY_INVENTORY_LAYOUT: {
        displayName: ACTION_MAPPINGS.APPLY_INVENTORY_LAYOUT.displayName,
        write: writeApplyInventoryLayout,
    },
    FUNCTION: {
        displayName: ACTION_MAPPINGS.FUNCTION.displayName,
        write: writeFunction,
    },
    RANDOM: {
        displayName: ACTION_MAPPINGS.RANDOM.displayName,
        write: writeRandom,
        hasNestedActionLists: true,
    },
    SET_GAMEMODE: {
        displayName: ACTION_MAPPINGS.SET_GAMEMODE.displayName,
        write: writeSetGamemode,
    },
    SET_COMPASS_TARGET: {
        displayName: ACTION_MAPPINGS.SET_COMPASS_TARGET.displayName,
        write: writeSetCompassTarget,
    },
    FAIL_PARKOUR: {
        displayName: ACTION_MAPPINGS.FAIL_PARKOUR.displayName,
        write: writeFailParkour,
    },
    PARKOUR_CHECKPOINT: {
        displayName: ACTION_MAPPINGS.PARKOUR_CHECKPOINT.displayName,
    },
    TELEPORT: {
        displayName: ACTION_MAPPINGS.TELEPORT.displayName,
        write: writeTeleport,
    },
    SEND_TO_LOBBY: {
        displayName: ACTION_MAPPINGS.SEND_TO_LOBBY.displayName,
        write: writeSendToLobby,
    },
    GIVE_EXPERIENCE_LEVELS: {
        displayName: ACTION_MAPPINGS.GIVE_EXPERIENCE_LEVELS.displayName,
        write: writeGiveExperienceLevels,
    },
    CLEAR_POTION_EFFECTS: {
        displayName: ACTION_MAPPINGS.CLEAR_POTION_EFFECTS.displayName,
    },
    CHANGE_MAX_HEALTH: {
        displayName: ACTION_MAPPINGS.CHANGE_MAX_HEALTH.displayName,
        write: writeChangeMaxHealth,
    },
    CHANGE_HEALTH: {
        displayName: ACTION_MAPPINGS.CHANGE_HEALTH.displayName,
        write: writeChangeHealth,
    },
    CHANGE_HUNGER: {
        displayName: ACTION_MAPPINGS.CHANGE_HUNGER.displayName,
        write: writeChangeHunger,
    },
    DROP_ITEM: {
        displayName: ACTION_MAPPINGS.DROP_ITEM.displayName,
        write: writeDropItem,
    },
    USE_HELD_ITEM: {
        displayName: ACTION_MAPPINGS.USE_HELD_ITEM.displayName,
    },
    SET_VELOCITY: {
        displayName: ACTION_MAPPINGS.SET_VELOCITY.displayName,
        write: writeSetVelocity,
    },
    LAUNCH: {
        displayName: ACTION_MAPPINGS.LAUNCH.displayName,
        write: writeLaunch,
    },
    CANCEL_EVENT: {
        displayName: ACTION_MAPPINGS.CANCEL_EVENT.displayName,
    },
} satisfies ActionSpecMap;

async function readOpenAction(
    ctx: TaskContext,
    type: Action["type"],
    emptyNestedProps?: Set<string>,
): Promise<Action> {
    const spec = getActionSpec(type);
    if (!spec.read) {
        if (!spec.write) {
            return { type } as Action;
        }
        throw new Error(`Reading action "${type}" is not implemented.`);
    }
    return spec.read(ctx, emptyNestedProps);
}

function getEmptyNestedListProps(slot: ItemSlot, type: Action["type"]): Set<string> {
    const mapping = ACTION_MAPPINGS[type];
    const loreFields = mapping.loreFields;
    const emptyProps = new Set<string>();
    const lore = slot.getItem().getLore();

    // Nested list lore uses two lines:
    //   Label:
    //    - None
    // Find the label line, then check if the next line is "- None".
    for (const label of Object.keys(loreFields)) {
        const field = loreFields[label];
        if (field.kind !== "nestedList") continue;

        for (let i = 0; i < lore.length - 1; i++) {
            const lineText = removedFormatting(lore[i]).trim();
            if (lineText === label + ":") {
                const nextLineText = removedFormatting(lore[i + 1]).trim();
                if (nextLineText === "- None") {
                    emptyProps.add(field.prop);
                }
                break;
            }
        }
    }

    return emptyProps;
}

function countNestedListFields(type: Action["type"]): number {
    const loreFields = ACTION_MAPPINGS[type].loreFields;
    let count = 0;
    for (const label of Object.keys(loreFields)) {
        if (loreFields[label].kind === "nestedList") count++;
    }
    return count;
}

function buildEmptyNestedAction(type: Action["type"], parsed: Action): Action {
    const mapping = ACTION_MAPPINGS[type];
    const result: Record<string, unknown> = { ...parsed };
    const loreFields = mapping.loreFields;
    for (const label of Object.keys(loreFields)) {
        const field = loreFields[label];
        if (field.kind === "nestedList") {
            result[field.prop] = [];
        }
    }
    return result as Action;
}

export async function readActionList(
    ctx: TaskContext,
): Promise<ObservedAction[]> {
    const slots = ctx.getAllItemSlots();
    if (slots === null) {
        throw new Error("No open container found");
    }

    const candidates = slots
        .map((slot) => {
            const displayName = displayNameForSlot(slot);
            return {
                slot,
                displayName,
                type: tryGetActionTypeFromDisplayName(displayName),
            };
        })
        .filter(
            (
                entry,
            ): entry is {
                slot: ItemSlot;
                displayName: string;
                type: Action["type"];
            } => entry.type !== undefined,
        );

    const observed: ObservedAction[] = [];
    for (const entry of candidates) {
        const parsed = parseActionListItem(entry.slot, entry.type);
        let action: Action | undefined;
        if (isActionFullyReadableFromList(entry.type)) {
            action = parsed;
        } else {
            const emptyNestedProps = getEmptyNestedListProps(entry.slot, entry.type);
            const nestedCount = countNestedListFields(entry.type);

            if (emptyNestedProps.size === nestedCount) {
                // All nested lists show "None" in lore — skip clicking in.
                action = buildEmptyNestedAction(entry.type, parsed);
            } else {
                const spec = getActionSpec(entry.type);
                if (spec.read) {
                    try {
                        entry.slot.click();
                        await waitForMenu(ctx);
                        action = await readOpenAction(ctx, entry.type, emptyNestedProps);
                        await clickGoBack(ctx);
                    } catch (err) {
                        if (ctx.tryGetItemSlot("Go Back") !== null) {
                            await clickGoBack(ctx);
                        }
                    }
                }
            }
        }

        observed.push({
            index: observed.length,
            slotId: entry.slot.getSlotId(),
            slot: entry.slot,
            displayName: entry.displayName,
            type: entry.type,
            action,
        });
    }

    return observed;
}

async function writeOpenAction(
    ctx: TaskContext,
    desired: Action,
    current?: Action,
): Promise<void> {
    const spec = getActionSpec(desired.type);
    if (spec.write) {
        await (spec.write as (ctx: TaskContext, desired: Action, current?: Action) => Promise<void>)(
            ctx, desired, current,
        );
    }

    if (desired.note) {
        await setStringValue(
            ctx,
            ctx.getItemSlot("Note"),
            normalizeNoteText(desired.note),
        );
    }
}

function hasExactDesiredMatchRemaining(
    observed: ObservedAction & { action: Action },
    desired: Action[],
    startIndex: number,
): boolean {
    for (let i = startIndex; i < desired.length; i++) {
        if (actionsEqual(observed.action, desired[i])) {
            return true;
        }
    }

    return false;
}

export function diffActionList(
    readActions: ObservedAction[],
    desired: Action[],
): ActionListDiff {
    const observed = [...readActions] as Array<ObservedAction & { action: Action; type: Action["type"] }>;
    const operations: ActionListOperation[] = [];

    for (let desiredIndex = 0; desiredIndex < desired.length; desiredIndex++) {
        const desiredAction = desired[desiredIndex];
        const current = observed[desiredIndex];
        const targetIndex = observed[desiredIndex]?.index ?? readActions.length;

        // 1. Fully equal → skip
        if (current && actionsEqual(current.action, desiredAction)) {
            continue;
        }

        // 2. Same type at current position → edit in place
        //    Skip if the desired action has an exact match later in observed
        //    (step 4 should move it instead of editing here).
        const hasExactLater = observed.findIndex(
            (entry, idx) => idx > desiredIndex && actionsEqual(entry.action, desiredAction),
        ) !== -1;

        if (
            current &&
            sameActionType(current.action, desiredAction) &&
            !hasExactDesiredMatchRemaining(current, desired, desiredIndex + 1) &&
            !hasExactLater
        ) {
            operations.push({
                kind: "edit",
                observed: current,
                desired: desiredAction,
            });
            continue;
        }

        // 3. Current item has no use in remaining desired → delete it
        if (current) {
            const remainingDesired = desired.slice(desiredIndex);
            const hasAnyUse = remainingDesired.some(
                (d) =>
                    actionsEqual(current.action, d) ||
                    sameActionType(current.action, d),
            );
            if (!hasAnyUse) {
                operations.push({ kind: "delete", observed: current });
                observed.splice(desiredIndex, 1);
                desiredIndex--;
                continue;
            }
        }

        // 4. Exact match elsewhere → move
        const matchIndex = observed.findIndex(
            (entry, index) =>
                index > desiredIndex && actionsEqual(entry.action, desiredAction),
        );
        if (matchIndex !== -1) {
            const [match] = observed.splice(matchIndex, 1);
            observed.splice(desiredIndex, 0, match);
            operations.push({
                kind: "move",
                fromIndex: match.index,
                toIndex: targetIndex,
                action: match.action,
            });
            continue;
        }

        // 4b. Same type elsewhere → move + edit (prefer reusing over delete+add)
        const sameTypeIndex = observed.findIndex(
            (entry, index) =>
                index > desiredIndex && sameActionType(entry.action, desiredAction),
        );
        if (sameTypeIndex !== -1) {
            const [match] = observed.splice(sameTypeIndex, 1);
            observed.splice(desiredIndex, 0, match);
            operations.push({
                kind: "move",
                fromIndex: match.index,
                toIndex: targetIndex,
                action: match.action,
            });
            operations.push({
                kind: "edit",
                observed: match,
                desired: desiredAction,
            });
            continue;
        }

        // 5. Not found → add
        operations.push({
            kind: "add",
            desired: desiredAction,
            toIndex: targetIndex,
        });
        observed.splice(desiredIndex, 0, {
            index: targetIndex,
            slotId: -1,
            slot: readActions[0]?.slot ?? (undefined as unknown as ItemSlot),
            displayName: getActionDisplayName(desiredAction.type),
            type: desiredAction.type,
            action: desiredAction,
        });
    }

    for (let index = observed.length - 1; index >= desired.length; index--) {
        operations.push({
            kind: "delete",
            observed: observed[index],
        });
    }

    return {
        operations,
    };
}

function readActionSlots(ctx: TaskContext): ItemSlot[] {
    const slots = ctx.getAllItemSlots();
    if (slots === null) return [];
    return slots.filter(
        (slot) => tryGetActionTypeFromDisplayName(displayNameForSlot(slot)) !== undefined,
    );
}

async function moveActionToIndex(
    ctx: TaskContext,
    fromIndex: number,
    toIndex: number,
): Promise<void> {
    const actionSlots = readActionSlots(ctx);
    const listLength = actionSlots.length;
    if (listLength <= 1) return;

    const targetIndex = ((toIndex % listLength) + listLength) % listLength;
    let currentIndex = ((fromIndex % listLength) + listLength) % listLength;

    for (let attempt = 0; attempt < 128 && currentIndex !== targetIndex; attempt++) {
        const rightDistance = (targetIndex - currentIndex + listLength) % listLength;
        const leftDistance = (currentIndex - targetIndex + listLength) % listLength;
        const button =
            leftDistance <= rightDistance ? MouseButton.LEFT : MouseButton.RIGHT;

        // Re-read slots each iteration — the slot refs shift after each swap.
        const currentSlots = readActionSlots(ctx);
        currentSlots[currentIndex].click(button, true);
        await waitForMenu(ctx);

        if (button === MouseButton.LEFT) {
            currentIndex = (currentIndex - 1 + listLength) % listLength;
        } else {
            currentIndex = (currentIndex + 1) % listLength;
        }
    }
}

async function openObservedAction(
    observed: ObservedAction,
    ctx: TaskContext,
): Promise<void> {
    observed.slot.click();
    await waitForMenu(ctx);
}

async function deleteObservedAction(
    observed: ObservedAction,
    ctx: TaskContext,
): Promise<void> {
    const currentDisplayName = displayNameForSlot(observed.slot);
    ctx.displayMessage(
        `&7[delete] Right-clicking slot #${observed.slotId} (index=${observed.index}). Expected: &f${observed.displayName}&7, actual slot name: &f${currentDisplayName}`,
    );
    if (currentDisplayName !== observed.displayName) {
        ctx.displayMessage(
            `&c[delete] WARNING: Slot contents changed! Expected "${observed.displayName}" but found "${currentDisplayName}". Slot reference may be stale.`,
        );
    }
    observed.slot.click(MouseButton.RIGHT);
    await waitForMenu(ctx);
}

async function applyActionListOperation(
    ctx: TaskContext,
    operation: ActionListOperation,
): Promise<void> {
    switch (operation.kind) {
        case "move":
            await moveActionToIndex(ctx, operation.fromIndex, operation.toIndex);
            return;
        case "edit":
            await openObservedAction(operation.observed, ctx);
            await writeOpenAction(
                ctx,
                operation.desired,
                operation.observed.action,
            );
            await clickGoBack(ctx);
            return;
        case "add":
            await importAction(ctx, operation.desired);
            // importAction appends to the end. Move from last slot to target.
            const lastIndex = readActionSlots(ctx).length - 1;
            await moveActionToIndex(ctx, lastIndex, operation.toIndex);
            return;
        case "delete":
            await deleteObservedAction(operation.observed, ctx);
            return;
        default:
            const _exhaustiveCheck: never = operation;
            return _exhaustiveCheck;
    }
}

async function applyActionListDiff(
    ctx: TaskContext,
    diff: ActionListDiff,
): Promise<void> {
    const edits: Array<ActionListOperation & { kind: "edit" }> = [];
    const deletes: Array<ActionListOperation & { kind: "delete" }> = [];
    const moves: Array<ActionListOperation & { kind: "move" }> = [];
    const adds: Array<ActionListOperation & { kind: "add" }> = [];

    for (const op of diff.operations) {
        switch (op.kind) {
            case "edit": edits.push(op); break;
            case "delete": deletes.push(op); break;
            case "move": moves.push(op); break;
            case "add": adds.push(op); break;
        }
    }

    // Deletes are handled separately by syncActionList after re-reading,
    // so we skip them here.

    ctx.displayMessage(`&7[apply] &6Applying ${edits.length} edit(s)...`);
    for (const op of edits) {
        ctx.displayMessage(`&7[apply]   editing ${formatObservedSummary(op.observed)} -> ${formatActionSummary(op.desired)}`);
        await applyActionListOperation(ctx, op);
    }

    ctx.displayMessage(`&7[apply] &eApplying ${moves.length} move(s)...`);
    for (const op of moves) {
        ctx.displayMessage(`&7[apply]   moving ${formatActionSummary(op.action)} ${op.fromIndex} -> ${op.toIndex}`);
        await applyActionListOperation(ctx, op);
    }

    ctx.displayMessage(`&7[apply] &aApplying ${adds.length} add(s)...`);
    for (const op of adds) {
        ctx.displayMessage(`&7[apply]   adding ${formatActionSummary(op.desired)} at index ${op.toIndex}`);
        await applyActionListOperation(ctx, op);
    }
}

function formatActionSummary(action: Action): string {
    const spec = getActionSpec(action.type);
    return `${spec.displayName} [${action.type}]`;
}

function formatObservedSummary(observed: ObservedAction): string {
    const actionStr = observed.action
        ? formatActionSummary(observed.action)
        : observed.displayName;
    const status = observed.action ? "full" : "partial";
    return `#${observed.index} ${actionStr} (read=${status})`;
}

function logObserved(ctx: TaskContext, observed: ObservedAction[]): void {
    ctx.displayMessage(`&7[sync] &eObserved ${observed.length} action(s):`);
    for (const entry of observed) {
        const statusColor = entry.action ? "&a" : "&c";
        const statusLabel = entry.action ? "full" : "partial";
        ctx.displayMessage(
            `&7  [${entry.index}] ${statusColor}${entry.displayName} &7(${statusLabel})`,
        );
    }
}

function logDiff(ctx: TaskContext, diff: ActionListDiff): void {
    ctx.displayMessage(`&7[sync] &dDiff: ${diff.operations.length} operation(s)`);
    for (const op of diff.operations) {
        switch (op.kind) {
            case "delete":
                ctx.displayMessage(`&7  &c[DELETE] ${formatObservedSummary(op.observed)}`);
                break;
            case "edit":
                ctx.displayMessage(
                    `&7  &6[EDIT] ${formatObservedSummary(op.observed)} &7-> &6${formatActionSummary(op.desired)}`,
                );
                break;
            case "add":
                ctx.displayMessage(`&7  &a[ADD] ${formatActionSummary(op.desired)} at index ${op.toIndex}`);
                break;
            case "move":
                ctx.displayMessage(`&7  &e[MOVE] ${formatActionSummary(op.action)} from ${op.fromIndex} -> ${op.toIndex}`);
                break;
        }
    }
}

export async function syncActionList(
    ctx: TaskContext,
    desired: Action[],
): Promise<void> {
    const observed = await readActionList(ctx);
    logObserved(ctx, observed);

    ctx.displayMessage(`&7[sync] &bDesired ${desired.length} action(s):`);
    for (let i = 0; i < desired.length; i++) {
        ctx.displayMessage(`&7  [${i}] &b${formatActionSummary(desired[i])}`);
    }

    const diff = diffActionList(observed, desired);
    logDiff(ctx, diff);

    // Phase 1: Apply deletes first (slot refs are fresh from the read).
    const deletes = diff.operations.filter(
        (op): op is ActionListOperation & { kind: "delete" } => op.kind === "delete",
    );

    if (deletes.length > 0) {
        deletes.sort((a, b) => b.observed.index - a.observed.index);
        ctx.displayMessage(`&7[sync] &cDeleting ${deletes.length} action(s)...`);
        const deletedIndices = new Set(deletes.map((op) => op.observed.index));
        for (const op of deletes) {
            ctx.displayMessage(`&7[sync]   deleting ${formatObservedSummary(op.observed)} (slotId=${op.observed.slotId})`);
            await deleteObservedAction(op.observed, ctx);
        }

        // Refresh slot refs in memory — just grab the container's current
        // slots (no sub-menu reads). The remaining observed actions shifted
        // positions after the deletes.
        const freshSlots = ctx.getAllItemSlots();
        const freshActionSlots = (freshSlots ?? []).filter((slot) =>
            tryGetActionTypeFromDisplayName(displayNameForSlot(slot)) !== undefined,
        );

        const remaining = observed.filter((o) => !deletedIndices.has(o.index));
        for (let i = 0; i < remaining.length && i < freshActionSlots.length; i++) {
            remaining[i].slot = freshActionSlots[i];
            remaining[i].slotId = freshActionSlots[i].getSlotId();
            remaining[i].index = i;
        }

        ctx.displayMessage(`&7[sync] &7Refreshed ${remaining.length} slot ref(s) in memory.`);
    }

    // Phase 2: Apply edits, moves, adds with corrected slot refs.
    await applyActionListDiff(ctx, diff);

    ctx.displayMessage("&7[sync] &aSync complete.");
}

async function selectActionType(
    ctx: TaskContext,
    type: Action["type"],
): Promise<void> {
    const spec = getActionSpec(type);
    const displayName = spec.displayName;

    const slot = await getSlotPaginate(ctx, displayName);

    if (isLimitExceeded(slot)) {
        throw Diagnostic.error(
            `Maximum amount of ${displayName} actions exceeded`,
        );
    }

    slot.click();
    await waitForMenu(ctx);
}

export async function importAction(
    ctx: TaskContext,
    action: Action,
): Promise<void> {
    ctx.getItemSlot("Add Action").click();
    await waitForMenu(ctx);
    await selectActionType(ctx, action.type);
    await writeOpenAction(ctx, action);
    const spec = getActionSpec(action.type);
    if (spec.write || action.note) {
        await clickGoBack(ctx);
    }
}
