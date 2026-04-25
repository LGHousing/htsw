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
    openSubmenu,
    enterValue,
    setStringValue,
    setBooleanValue,
    setSelectValue,
    setCycleValue,
    setNumberValue,
    readBooleanValue,
    setListItemNote,
} from "./helpers";
import { ItemSlot, MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import { Diagnostic } from "htsw";
import { readConditionList, syncConditionList } from "./conditions";
import { normalizeActionCompare } from "./compare";
import { isSyncDebugLoggingEnabled } from "./debug";
import {
    ACTION_MAPPINGS,
    getNestedListFields,
    parseActionListItem,
    tryGetActionTypeFromDisplayName,
} from "./actionMappings";
import { diffActionList } from "./actions/diff";
import type {
    ActionListDiff,
    ActionListReadMode,
    ActionListOperation,
    NestedHydrationPlan,
    NestedListProp,
    NestedPropsToRead,
    NestedSummaries,
    Observed,
    ObservedActionSlot,
} from "./types";
import { createNestedHydrationPlan } from "./actions/hydrationPlan";
import { tryGetConditionTypeFromDisplayName } from "./conditionMappings";

export { diffActionList };
export type {
    ActionListDiff,
    ActionListOperation,
    NestedListProp,
    NestedPropsToRead,
    ObservedActionSlot as ObservedAction,
} from "./types";

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

const ACTION_ITEMS_PER_PAGE = 21;
const ACTION_PREV_PAGE_SLOT_ID = 45;
const ACTION_NEXT_PAGE_SLOT_ID = 53;

function getVisibleActionItemSlots(ctx: TaskContext): ItemSlot[] {
    const slots = ctx.getAllItemSlots((slot) => {
        const slotId = slot.getSlotId();
        const row = Math.floor(slotId / 9);
        const col = slotId % 9;
        return row >= 1 && row <= 3 && col >= 1 && col <= 7;
    });
    if (slots === null) {
        throw new Error("No open container found");
    }
    return slots.sort((a, b) => a.getSlotId() - b.getSlotId());
}

function isNoActionsPlaceholder(slot: ItemSlot): boolean {
    return removedFormatting(slot.getItem().getName()).trim() === "No Actions!";
}

function parsePaginatedTitlePage(
    title: string
): { currentPage: number; totalPages: number } | null {
    const trimmedTitle = title.trim();
    const exactMatch = trimmedTitle.match(/^\((\d+)\/(\d+)\)\s+/);
    if (exactMatch) {
        const currentPage = Number(exactMatch[1]);
        const totalPages = Number(exactMatch[2]);
        if (
            !Number.isInteger(currentPage) ||
            !Number.isInteger(totalPages) ||
            currentPage < 1 ||
            totalPages < 1 ||
            currentPage > totalPages
        ) {
            throw new Error(`Invalid paginated action title: "${title}"`);
        }
        return { currentPage, totalPages };
    }

    if (/\([^)]*\)\s*$/.test(trimmedTitle) || /^\([^)]*\)\s+/.test(trimmedTitle)) {
        throw new Error(`Malformed paginated action title: "${title}"`);
    }

    return null;
}

function hasActionNextPage(ctx: TaskContext): boolean {
    return (
        ctx.tryGetItemSlot((slot) => slot.getSlotId() === ACTION_NEXT_PAGE_SLOT_ID) !==
        null
    );
}

function hasActionPrevPage(ctx: TaskContext): boolean {
    return (
        ctx.tryGetItemSlot((slot) => slot.getSlotId() === ACTION_PREV_PAGE_SLOT_ID) !==
        null
    );
}

function getCurrentActionPageState(ctx: TaskContext): {
    currentPage: number;
    totalPages: number | null;
    hasNext: boolean;
    hasPrev: boolean;
} {
    const title = ctx.getOpenContainerTitle();
    if (title === null) {
        throw new Error("No open container found");
    }

    const parsedTitle = parsePaginatedTitlePage(title);
    const hasNext = hasActionNextPage(ctx);
    if (parsedTitle === null) {
        return {
            currentPage: 1,
            totalPages: hasNext ? null : 1,
            hasNext,
            hasPrev: false,
        };
    }

    return {
        currentPage: parsedTitle.currentPage,
        totalPages: parsedTitle.totalPages,
        hasNext,
        hasPrev: hasActionPrevPage(ctx),
    };
}

function getActionPageForIndex(index: number): number {
    return Math.floor(index / ACTION_ITEMS_PER_PAGE) + 1;
}

function getActionLocalIndex(index: number): number {
    return index % ACTION_ITEMS_PER_PAGE;
}

async function goToActionPage(ctx: TaskContext, targetPage: number): Promise<void> {
    if (!Number.isInteger(targetPage) || targetPage < 1) {
        throw new Error(`Invalid target action page: ${targetPage}`);
    }

    while (true) {
        const state = getCurrentActionPageState(ctx);
        if (state.currentPage === targetPage) {
            return;
        }

        if (state.currentPage < targetPage) {
            if (!state.hasNext) {
                throw new Error(
                    `Cannot move to action page ${targetPage}; no next page from ${state.currentPage}.`
                );
            }

            ctx.getItemSlot(
                (slot) => slot.getSlotId() === ACTION_NEXT_PAGE_SLOT_ID
            ).click();
            await waitForMenu(ctx);

            const nextState = getCurrentActionPageState(ctx);
            if (nextState.currentPage <= state.currentPage) {
                throw new Error("Action page did not advance after clicking next page.");
            }
            continue;
        }

        if (!state.hasPrev) {
            throw new Error(
                `Cannot move to action page ${targetPage}; no previous page from ${state.currentPage}.`
            );
        }

        ctx.getItemSlot((slot) => slot.getSlotId() === ACTION_PREV_PAGE_SLOT_ID).click();
        await waitForMenu(ctx);

        const prevState = getCurrentActionPageState(ctx);
        if (prevState.currentPage >= state.currentPage) {
            throw new Error("Action page did not go back after clicking previous page.");
        }
    }
}

async function getActionSlotAtIndex(
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<ItemSlot> {
    if (listLength <= 0 || index < 0 || index >= listLength) {
        throw new Error(
            `Action index ${index} is out of bounds for list length ${listLength}.`
        );
    }

    await goToActionPage(ctx, getActionPageForIndex(index));
    const visibleSlots = getVisibleActionItemSlots(ctx);
    const localIndex = getActionLocalIndex(index);
    const slot = visibleSlots[localIndex];
    if (!slot) {
        throw new Error(
            `Could not resolve visible action slot ${localIndex} for global index ${index}.`
        );
    }

    return slot;
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
        for (const entry of await readActionList(ctx, { kind: "full" })) {
            ifActions.push(entry.action);
        }
        await clickGoBack(ctx);
    }

    const elseActions: (Observed<Action> | null)[] = [];
    if (propsToRead.has("elseActions")) {
        ctx.getItemSlot("Else Actions").click();
        await waitForMenu(ctx);
        for (const entry of await readActionList(ctx, { kind: "full" })) {
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

async function writeSetGroup(ctx: TaskContext, action: ActionSetGroup): Promise<void> {
    await setSelectValue(ctx, "Group", action.group);

    if (action.demotionProtection !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Demotion Protection"),
            action.demotionProtection
        );
    }
}

async function writeTitle(ctx: TaskContext, action: ActionTitle): Promise<void> {
    await setStringValue(ctx, ctx.getItemSlot("Title"), action.title);

    if (action.subtitle !== undefined) {
        await setStringValue(ctx, ctx.getItemSlot("Subtitle"), action.subtitle);
    }

    if (action.fadein !== undefined) {
        await setNumberValue(ctx, ctx.getItemSlot("Fadein"), action.fadein);
    }

    if (action.stay !== undefined) {
        await setNumberValue(ctx, ctx.getItemSlot("Stay"), action.stay);
    }

    if (action.fadeout !== undefined) {
        await setNumberValue(ctx, ctx.getItemSlot("Fadeout"), action.fadeout);
    }
}

async function writeActionBar(ctx: TaskContext, action: ActionActionBar): Promise<void> {
    await setStringValue(ctx, ctx.getItemSlot("Message"), action.message);
}

async function writeChangeMaxHealth(
    ctx: TaskContext,
    action: ActionChangeMaxHealth
): Promise<void> {
    await setSelectValue(ctx, "Mode", action.op);
    await setStringValue(ctx, ctx.getItemSlot("Max Health"), action.amount);

    if (action.heal !== undefined) {
        await setBooleanValue(ctx, ctx.getItemSlot("Heal On Change"), action.heal);
    }
}

async function writeGiveItem(ctx: TaskContext, action: ActionGiveItem): Promise<void> {
    throw new Error(
        `Writing Give Item item selection is not implemented; cannot set item "${action.itemName}".`
    );
}

async function writeRemoveItem(
    ctx: TaskContext,
    action: ActionRemoveItem
): Promise<void> {
    if (action.itemName !== undefined) {
        throw new Error(
            `Writing Remove Item item selection is not implemented; cannot set item "${action.itemName}".`
        );
    }
}

async function writeSendMessage(
    ctx: TaskContext,
    action: ActionSendMessage
): Promise<void> {
    await setStringValue(ctx, ctx.getItemSlot("Message"), action.message);
}

async function writeApplyPotionEffect(
    ctx: TaskContext,
    action: ActionApplyPotionEffect
): Promise<void> {
    await setSelectValue(ctx, "Effect", action.effect);
    await setNumberValue(ctx, ctx.getItemSlot("Duration"), action.duration);

    if (action.level !== undefined) {
        await setNumberValue(ctx, ctx.getItemSlot("Level"), action.level);
    }

    if (action.override !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Override Existing Effects"),
            action.override
        );
    }

    if (action.showIcon !== undefined) {
        await setBooleanValue(ctx, ctx.getItemSlot("Show Potion Icon"), action.showIcon);
    }
}

async function writeGiveExperienceLevels(
    ctx: TaskContext,
    action: ActionGiveExperienceLevels
): Promise<void> {
    await setStringValue(ctx, ctx.getItemSlot("Levels"), action.amount);
}

async function writeSendToLobby(
    ctx: TaskContext,
    action: ActionSendToLobby
): Promise<void> {
    if (action.lobby !== undefined) {
        await setSelectValue(ctx, "Location", action.lobby);
    }
}

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

async function writeTeleport(ctx: TaskContext, action: ActionTeleport): Promise<void> {
    if (action.location.type === "Custom Coordinates") {
        await openSubmenu(ctx, "Location");
        const optionSlot = await getSlotPaginate(ctx, "Custom Coordinates");
        optionSlot.click();
        await enterValue(ctx, action.location.value);
        await waitForMenu(ctx);
    } else {
        await setSelectValue(ctx, "Location", action.location.type);
    }

    if (action.preventTeleportInsideBlocks !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Prevent Teleport Inside Blocks"),
            action.preventTeleportInsideBlocks
        );
    }
}

async function writeFailParkour(
    ctx: TaskContext,
    action: ActionFailParkour
): Promise<void> {
    if (action.message !== undefined) {
        await setStringValue(ctx, ctx.getItemSlot("Reason"), action.message);
    }
}

async function writePlaySound(ctx: TaskContext, action: ActionPlaySound): Promise<void> {
    await setSelectValue(ctx, "Sound", action.sound);

    if (action.volume !== undefined) {
        await setNumberValue(ctx, ctx.getItemSlot("Volume"), action.volume);
    }

    if (action.pitch !== undefined) {
        await setNumberValue(ctx, ctx.getItemSlot("Pitch"), action.pitch);
    }

    if (action.location !== undefined) {
        if (action.location.type === "Custom Coordinates") {
            await openSubmenu(ctx, "Location");
            const optionSlot = await getSlotPaginate(ctx, "Custom Coordinates");
            optionSlot.click();
            await enterValue(ctx, action.location.value);
            await waitForMenu(ctx);
        } else {
            await setSelectValue(ctx, "Location", action.location.type);
        }
    }
}

async function writeSetCompassTarget(
    ctx: TaskContext,
    action: ActionSetCompassTarget
): Promise<void> {
    if (action.location.type === "Custom Coordinates") {
        await openSubmenu(ctx, "Location");
        const optionSlot = await getSlotPaginate(ctx, "Custom Coordinates");
        optionSlot.click();
        await enterValue(ctx, action.location.value);
        await waitForMenu(ctx);
    } else {
        await setSelectValue(ctx, "Location", action.location.type);
    }
}

async function writeSetGamemode(
    ctx: TaskContext,
    action: ActionSetGamemode
): Promise<void> {
    await setSelectValue(ctx, "Gamemode", action.gamemode);
}

async function writeChangeHealth(
    ctx: TaskContext,
    action: ActionChangeHealth
): Promise<void> {
    await setSelectValue(ctx, "Mode", action.op);
    await setStringValue(ctx, ctx.getItemSlot("Health"), action.amount);
}

async function writeChangeHunger(
    ctx: TaskContext,
    action: ActionChangeHunger
): Promise<void> {
    await setSelectValue(ctx, "Mode", action.op);
    await setStringValue(ctx, ctx.getItemSlot("Level"), action.amount);
}

async function readOpenRandom(
    ctx: TaskContext,
    propsToRead: NestedPropsToRead
): Promise<Observed<ActionRandom>> {
    const actions: (Observed<Action> | null)[] = [];
    ctx.getItemSlot("Actions").click();
    await waitForMenu(ctx);
    for (const entry of await readActionList(ctx, { kind: "full" })) {
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

async function writeFunction(ctx: TaskContext, action: ActionFunction): Promise<void> {
    await setStringValue(ctx, ctx.getItemSlot("Function"), action.function);

    if (action.global !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Trigger For All Players"),
            action.global
        );
    }
}

async function writeApplyInventoryLayout(
    ctx: TaskContext,
    action: ActionApplyInventoryLayout
): Promise<void> {
    await setSelectValue(ctx, "Layout", action.layout);
}

async function writeEnchantHeldItem(
    ctx: TaskContext,
    action: ActionEnchantHeldItem
): Promise<void> {
    await setSelectValue(ctx, "Enchantment", action.enchant);
    await setNumberValue(ctx, ctx.getItemSlot("Level"), action.level);
}

async function writePause(
    ctx: TaskContext,
    action: ActionPauseExecution
): Promise<void> {
    await setNumberValue(ctx, ctx.getItemSlot("Ticks To Wait"), action.ticks);
}

async function writeSetTeam(ctx: TaskContext, action: ActionSetTeam): Promise<void> {
    await setSelectValue(ctx, "Team", action.team);
}

async function writeDisplayMenu(
    ctx: TaskContext,
    action: ActionDisplayMenu
): Promise<void> {
    await setSelectValue(ctx, "Menu", action.menu);
}

async function writeDropItem(ctx: TaskContext, action: ActionDropItem): Promise<void> {
    throw new Error(
        `Writing Drop Item item selection is not implemented; cannot set item "${action.itemName}".`
    );
}

async function writeSetVelocity(
    ctx: TaskContext,
    action: ActionSetVelocity
): Promise<void> {
    await setStringValue(ctx, ctx.getItemSlot("X Direction"), action.x);
    await setStringValue(ctx, ctx.getItemSlot("Y Direction"), action.y);
    await setStringValue(ctx, ctx.getItemSlot("Z Direction"), action.z);
}

async function writeLaunch(ctx: TaskContext, action: ActionLaunch): Promise<void> {
    if (action.location.type === "Custom Coordinates") {
        await openSubmenu(ctx, "Target Location");
        const optionSlot = await getSlotPaginate(ctx, "Custom Coordinates");
        optionSlot.click();
        await enterValue(ctx, action.location.value);
        await waitForMenu(ctx);
    } else {
        await setSelectValue(ctx, "Target Location", action.location.type);
    }
    await setNumberValue(ctx, ctx.getItemSlot("Launch Strength"), action.strength);
}

async function writeSetPlayerWeather(
    ctx: TaskContext,
    action: ActionSetPlayerWeather
): Promise<void> {
    await setSelectValue(ctx, "Weather", action.weather);
}

async function writeSetPlayerTime(
    ctx: TaskContext,
    action: ActionSetPlayerTime
): Promise<void> {
    await setCycleValue(ctx, "Time", [action.time], action.time);
}

async function writeToggleNametagDisplay(
    ctx: TaskContext,
    action: ActionToggleNametagDisplay
): Promise<void> {
    await setBooleanValue(ctx, ctx.getItemSlot("Display Nametag"), action.displayNametag);
}

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

function readNestedSummaries(
    action: Observed<Action>,
    slot: ItemSlot
): { summaries: NestedSummaries; propsToRead: NestedPropsToRead } {
    const nestedFields = getNestedListFields(action.type);
    const lore = slot.getItem().getLore();
    const summaries: NestedSummaries = {};
    const propsToRead: NestedPropsToRead = new Set();
    const labels = new Set(nestedFields.map((field) => field.label));

    for (const { label, prop } of nestedFields) {
        const itemTypes: string[] = [];
        let labelIndex = -1;
        for (let i = 0; i < lore.length; i++) {
            if (removedFormatting(lore[i]).trim() === label + ":") {
                labelIndex = i;
                break;
            }
        }

        if (labelIndex === -1) {
            continue;
        }

        for (let i = labelIndex + 1; i < lore.length; i++) {
            const text = removedFormatting(lore[i]).trim();
            if (text === "") break;
            if (text.startsWith("minecraft:") || text.startsWith("NBT:")) break;
            if (
                text === "Left Click to edit!" ||
                text === "Right Click to remove!" ||
                text === "Click to edit!" ||
                text.startsWith("Use shift ")
            ) {
                break;
            }
            if (text.endsWith(":") && labels.has(text.slice(0, -1))) {
                break;
            }
            if (!text.startsWith("- ")) {
                break;
            }

            const displayName = text.slice(2).trim();
            if (displayName === "None") {
                continue;
            }

            const type =
                prop === "conditions"
                    ? tryGetConditionTypeFromDisplayName(displayName)
                    : tryGetActionTypeFromDisplayName(displayName);
            itemTypes.push(type ?? "UNKNOWN");
        }

        summaries[prop as NestedListProp] = itemTypes;
        if (itemTypes.length === 0) {
            Object.assign(action, { [prop]: [] });
        } else {
            propsToRead.add(prop as NestedListProp);
        }
    }

    return { summaries, propsToRead };
}

export async function readActionsListPage(
    ctx: TaskContext
): Promise<ObservedActionSlot[]> {
    const slots = getVisibleActionItemSlots(ctx).filter(
        (slot) => !isNoActionsPlaceholder(slot)
    );
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
                nestedReadState: "none",
                nestedSummaries: {},
                nestedPropsToRead: new Set(),
            };
            if (!entry.type) {
                return observed;
            }

            const action = parseActionListItem(entry.slot, entry.type);
            const nested = readNestedSummaries(action, entry.slot);
            observed.action = action;
            observed.nestedReadState =
                getNestedListFields(action.type).length === 0 ? "none" : "summary";
            observed.nestedSummaries = nested.summaries;
            observed.nestedPropsToRead = nested.propsToRead;
            return observed;
        });

    return observed;
}

export async function readActionList(
    ctx: TaskContext,
    mode: ActionListReadMode = { kind: "full" }
): Promise<ObservedActionSlot[]> {
    await goToActionPage(ctx, 1);
    const observed: ObservedActionSlot[] = [];

    while (true) {
        const pageObserved = await readActionsListPage(ctx);
        for (const entry of pageObserved) {
            entry.index = observed.length;
            observed.push(entry);
        }

        const state = getCurrentActionPageState(ctx);
        if (!state.hasNext) {
            break;
        }

        ctx.getItemSlot((slot) => slot.getSlotId() === ACTION_NEXT_PAGE_SLOT_ID).click();
        await waitForMenu(ctx);
    }

    await goToActionPage(ctx, 1);
    const plan: NestedHydrationPlan =
        mode.kind === "full"
            ? buildFullHydrationPlan(observed)
            : createNestedHydrationPlan(observed, mode.desired);
    await hydrateNestedActions(ctx, plan, observed.length);

    await goToActionPage(ctx, 1);
    return observed;
}

function buildFullHydrationPlan(
    observed: readonly ObservedActionSlot[]
): NestedHydrationPlan {
    const plan: NestedHydrationPlan = new Map();
    for (const entry of observed) {
        if (entry.nestedPropsToRead && entry.nestedPropsToRead.size > 0) {
            plan.set(entry, entry.nestedPropsToRead);
        }
    }
    return plan;
}

async function hydrateNestedActions(
    ctx: TaskContext,
    plan: NestedHydrationPlan,
    listLength: number
): Promise<void> {
    for (const [entry, propsToRead] of plan) {
        if (propsToRead.size === 0) continue;
        await hydrateNestedAction(ctx, entry, propsToRead, listLength);
    }
}

async function hydrateNestedAction(
    ctx: TaskContext,
    entry: ObservedActionSlot,
    propsToRead: NestedPropsToRead,
    listLength: number
): Promise<void> {
    if (entry.action === null) {
        return;
    }

    const note = entry.action.note;
    try {
        await goToActionPage(ctx, getActionPageForIndex(entry.index));
        const actionSlot = await getActionSlotAtIndex(ctx, entry.index, listLength);
        entry.slot = actionSlot;
        entry.slotId = actionSlot.getSlotId();

        actionSlot.click();
        await waitForMenu(ctx);
        const spec = getActionSpec(entry.action.type);
        if (!spec.read) {
            throw new Error(`Reading action "${entry.action.type}" is not implemented.`);
        }

        entry.action = await spec.read(ctx, propsToRead);
        entry.nestedReadState = "full";
        if (note) {
            entry.action.note = note;
        }
        await clickGoBack(ctx);
    } catch (error) {
        ctx.displayMessage(
            `&7[action-read] &cFailed to read nested action at index ${entry.index} (${entry.action.type}): ${error}`
        );
        if (ctx.tryGetItemSlot("Go Back") !== null) {
            await clickGoBack(ctx);
        }
    }
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
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<void> {
    const slot = await getActionSlotAtIndex(ctx, index, listLength);
    slot.click(MouseButton.RIGHT);
    await waitForMenu(ctx);
}

async function moveActionToIndex(
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

        const currentSlot = await getActionSlotAtIndex(ctx, currentIndex, listLength);
        currentSlot.click(button, true);
        await waitForMenu(ctx);

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
        const itemSlots = getVisibleActionItemSlots(ctx);
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
        const currentObserved = [...observed];

        for (const op of deletes) {
            const index = currentObserved.indexOf(op.observed);
            if (index === -1) {
                continue;
            }

            await deleteObservedAction(ctx, index, currentObserved.length);
            currentObserved.splice(index, 1);
        }
    }

    const remainingObserved = observed.filter(
        (entry) => !deletes.some((op) => op.observed === entry)
    );
    for (let i = 0; i < remainingObserved.length; i++) {
        remainingObserved[i].index = i;
    }

    // Edits before moves: edits use slot refs from readActionList which
    // become stale after moves shift actions around. Moves re-read slots
    // internally so they're unaffected by prior edits.
    for (const op of edits) {
        const currentIndex = remainingObserved.indexOf(op.observed);
        if (currentIndex === -1) {
            continue;
        }

        const actionSlot = await getActionSlotAtIndex(
            ctx,
            currentIndex,
            remainingObserved.length
        );
        op.observed.slot = actionSlot;
        op.observed.slotId = actionSlot.getSlotId();

        if (op.noteOnly) {
            await setListItemNote(ctx, actionSlot, op.desired.note);
            continue;
        }

        const spec = getActionSpec(op.desired.type);
        if (spec.write) {
            actionSlot.click();
            await waitForMenu(ctx);

            if (!op.observed.action) {
                throw new Error(
                    "Observed action should always be present for edit operations."
                );
            }

            await writeOpenAction(ctx, op.desired, op.observed.action);
            await clickGoBack(ctx);
        }

        await setListItemNote(ctx, actionSlot, op.desired.note);
    }

    moves.sort((a, b) => a.toIndex - b.toIndex);
    for (const op of moves) {
        const fromIndex = remainingObserved.indexOf(op.observed);
        if (fromIndex === -1) {
            continue;
        }

        await moveActionToIndex(ctx, fromIndex, op.toIndex, remainingObserved.length);

        remainingObserved.splice(fromIndex, 1);
        remainingObserved.splice(op.toIndex, 0, op.observed);
        for (let i = 0; i < remainingObserved.length; i++) {
            remainingObserved[i].index = i;
        }
    }

    adds.sort((a, b) => a.toIndex - b.toIndex);
    let currentLength = remainingObserved.length;
    for (const op of adds) {
        const actionToImport =
            op.desired.note === undefined
                ? op.desired
                : ({ ...op.desired, note: undefined } as Action);

        await importAction(ctx, actionToImport);
        await moveActionToIndex(ctx, currentLength, op.toIndex, currentLength + 1);

        const insertedAction: ObservedActionSlot = {
            index: op.toIndex,
            slotId: -1,
            slot: null as never,
            action: op.desired as Observed<Action>,
        };
        remainingObserved.splice(op.toIndex, 0, insertedAction);
        currentLength += 1;
        for (let i = 0; i < remainingObserved.length; i++) {
            remainingObserved[i].index = i;
        }

        if (op.desired.note !== undefined) {
            const addedSlot = await getActionSlotAtIndex(ctx, op.toIndex, currentLength);
            await setListItemNote(ctx, addedSlot, op.desired.note);
        }
    }

    await goToActionPage(ctx, 1);
}

function actionLogLabel(action: Action | Observed<Action> | null | undefined): string {
    if (action === null || action === undefined) {
        return "Unknown Action";
    }

    if (action.type === "CONDITIONAL") {
        return `CONDITIONAL (${action.conditions.length}/${action.ifActions.length}/${action.elseActions.length})`;
    }

    if (action.type === "RANDOM") {
        return `RANDOM (${action.actions.length})`;
    }

    return action.type;
}

function chatJsonLines(ctx: TaskContext, prefix: string, value: unknown): void {
    const json = JSON.stringify(value, null, 2);
    if (json === undefined) {
        ctx.displayMessage(`${prefix} undefined`);
        return;
    }

    for (const line of json.split("\n")) {
        ctx.displayMessage(`${prefix} ${line}`);
    }
}

function logSyncDebug(ctx: TaskContext, diff: ActionListDiff): void {
    if (!isSyncDebugLoggingEnabled()) {
        return;
    }

    for (const op of diff.operations) {
        if (op.kind !== "edit") {
            continue;
        }

        ctx.displayMessage(
            `&8[sync-debug] edit [${op.observed.index}] ${actionLogLabel(op.observed.action)}`
        );
        chatJsonLines(
            ctx,
            "&8  observed:",
            normalizeActionCompare(op.observed.action as Observed<Action>)
        );
        chatJsonLines(ctx, "&8  desired: ", normalizeActionCompare(op.desired));
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
                ctx.displayMessage(
                    `&7  &c- [${op.observed.index}] ${actionLogLabel(op.observed.action)}`
                );
                break;
            case "edit":
                ctx.displayMessage(
                    `&7  &6~ [${op.observed.index}] ${actionLogLabel(op.observed.action)} &7-> &6${actionLogLabel(op.desired)}`
                );
                break;
            case "add":
                ctx.displayMessage(
                    `&7  &a+ [${op.toIndex}] ${actionLogLabel(op.desired)}`
                );
                break;
            case "move":
                ctx.displayMessage(
                    `&7  &e> [${op.observed.index} -> ${op.toIndex}] ${actionLogLabel(op.action)}`
                );
                break;
        }
    }
}

export type SyncActionListOptions = {
    /**
     * Pre-read observed list to use instead of reading from the menu.
     *
     * The exporter and (future) trust-mode hand the importer a known-good
     * observation so a second `readActionList` round trip can be avoided.
     * If absent, the menu is read in `{ kind: "sync", desired }` mode as
     * before.
     */
    observed?: ObservedActionSlot[];
};

export type SyncActionListResult = {
    /**
     * The observed list the diff was computed against — either the one
     * passed in via `options.observed`, or a fresh read. Returned so
     * callers can hand it to the knowledge writer without re-reading.
     */
    usedObserved: ObservedActionSlot[];
};

export async function syncActionList(
    ctx: TaskContext,
    desired: Action[],
    options?: SyncActionListOptions
): Promise<SyncActionListResult> {
    const observed =
        options?.observed ??
        (await readActionList(ctx, { kind: "sync", desired }));
    const diff = diffActionList(observed, desired);
    logSyncState(ctx, diff);
    logSyncDebug(ctx, diff);
    await applyActionListDiff(ctx, observed, diff);
    return { usedObserved: observed };
}
