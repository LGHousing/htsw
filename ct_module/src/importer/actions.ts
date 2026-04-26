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
import type { ImportContext } from "../importables/context";
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
    readStringValue,
    setListItemNote,
} from "./helpers";
import { ItemSlot, MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import { Diagnostic } from "htsw";
import {
    canonicalizeObservedConditionItemNames,
    readConditionList,
    syncConditionList,
} from "./conditions";
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
import {
    clickPaginatedNextPage,
    getCurrentPaginatedListPageState,
    getPaginatedListPageForIndex,
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    goToPaginatedListPage,
    isEmptyPaginatedPlaceholder,
    type PaginatedListConfig,
} from "./paginatedList";
import { setItemValue } from "./items";

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
    read?: (
        ctx: TaskContext,
        propsToRead: NestedPropsToRead,
        importContext?: ImportContext
    ) => Promise<Observed<T>>;
    write?: (
        ctx: TaskContext,
        desired: T,
        current?: Observed<T>,
        importContext?: ImportContext
    ) => Promise<void>;
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

function resolveActionItem(
    importContext: ImportContext | undefined,
    actionType: Action["type"],
    itemName: string
): Item {
    if (importContext === undefined) {
        throw new Error(
            `Cannot set item "${itemName}" for ${actionType}: no import context is available.`
        );
    }

    const entry = importContext.items.resolve(itemName);
    if (entry === undefined) {
        throw new Error(
            `Cannot set item "${itemName}" for ${actionType}: item fields resolve against top-level items[].name.`
        );
    }

    return entry.item;
}

const ACTION_LIST_CONFIG: PaginatedListConfig = {
    label: "action",
    emptyPlaceholderName: "No Actions!",
};

function getVisibleActionItemSlots(ctx: TaskContext): ItemSlot[] {
    return getVisiblePaginatedItemSlots(ctx);
}

function isNoActionsPlaceholder(slot: ItemSlot): boolean {
    return isEmptyPaginatedPlaceholder(slot, ACTION_LIST_CONFIG);
}

function getCurrentActionPageState(ctx: TaskContext): {
    currentPage: number;
    totalPages: number | null;
    hasNext: boolean;
    hasPrev: boolean;
} {
    return getCurrentPaginatedListPageState(ctx, ACTION_LIST_CONFIG);
}

function getActionPageForIndex(index: number): number {
    return getPaginatedListPageForIndex(index);
}

async function goToActionPage(ctx: TaskContext, targetPage: number): Promise<void> {
    await goToPaginatedListPage(ctx, targetPage, ACTION_LIST_CONFIG);
}

async function getActionSlotAtIndex(
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<ItemSlot> {
    return getPaginatedListSlotAtIndex(ctx, index, listLength, ACTION_LIST_CONFIG);
}

async function readOpenConditional(
    ctx: TaskContext,
    propsToRead: NestedPropsToRead,
    importContext?: ImportContext
): Promise<Observed<ActionConditional>> {
    let conditions: (Condition | null)[] = [];
    if (propsToRead.has("conditions")) {
        ctx.getItemSlot("Conditions").click();
        await waitForMenu(ctx);
        conditions = (await readConditionList(ctx, { importContext })).map(
            (entry) => entry.condition
        );
        await clickGoBack(ctx);
    }

    const matchAny = readBooleanValue(ctx.getItemSlot("Match Any Condition")) ?? false;

    const ifActions: (Observed<Action> | null)[] = [];
    if (propsToRead.has("ifActions")) {
        ctx.getItemSlot("If Actions").click();
        await waitForMenu(ctx);
        for (const entry of await readActionList(ctx, {
            kind: "full",
            importContext,
        })) {
            ifActions.push(entry.action);
        }
        await clickGoBack(ctx);
    }

    const elseActions: (Observed<Action> | null)[] = [];
    if (propsToRead.has("elseActions")) {
        ctx.getItemSlot("Else Actions").click();
        await waitForMenu(ctx);
        for (const entry of await readActionList(ctx, {
            kind: "full",
            importContext,
        })) {
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
    action: ActionConditional,
    current?: Observed<ActionConditional>,
    importContext?: ImportContext
): Promise<void> {
    if (action.conditions.length > 0 || (current?.conditions?.length ?? 0) > 0) {
        ctx.getItemSlot("Conditions").click();
        await waitForMenu(ctx);

        await syncConditionList(ctx, action.conditions, { importContext });
        await clickGoBack(ctx);
    }

    await setBooleanValue(ctx, ctx.getItemSlot("Match Any Condition"), action.matchAny);

    if (action.ifActions.length > 0 || (current?.ifActions?.length ?? 0) > 0) {
        ctx.getItemSlot("If Actions").click();
        await waitForMenu(ctx);
        await syncActionList(ctx, action.ifActions, { importContext });
        await clickGoBack(ctx);
    }

    if (action.elseActions.length > 0 || (current?.elseActions?.length ?? 0) > 0) {
        ctx.getItemSlot("Else Actions").click();
        await waitForMenu(ctx);
        await syncActionList(ctx, action.elseActions, { importContext });
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

async function writeGiveItem(
    ctx: TaskContext,
    action: ActionGiveItem,
    _current?: Observed<ActionGiveItem>,
    importContext?: ImportContext
): Promise<void> {
    await setItemValue(
        ctx,
        "Item",
        resolveActionItem(importContext, action.type, action.itemName)
    );

    if (action.allowMultiple !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Allow Multiple"),
            action.allowMultiple
        );
    }

    if (action.slot !== undefined) {
        await setSelectValue(ctx, "Inventory Slot", String(action.slot));
    }

    if (action.replaceExisting !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Replace Existing Item"),
            action.replaceExisting
        );
    }
}

async function writeRemoveItem(
    ctx: TaskContext,
    action: ActionRemoveItem,
    _current?: Observed<ActionRemoveItem>,
    importContext?: ImportContext
): Promise<void> {
    if (action.itemName !== undefined) {
        await setItemValue(
            ctx,
            "Item",
            resolveActionItem(importContext, action.type, action.itemName)
        );
    }
}

async function writeSendMessage(
    ctx: TaskContext,
    action: ActionSendMessage
): Promise<void> {
    await setStringValue(ctx, ctx.getItemSlot("Message"), action.message);
}

async function readOpenMessage(ctx: TaskContext): Promise<Observed<ActionSendMessage>> {
    return {
        type: "MESSAGE",
        message: readStringValue(ctx.getItemSlot("Message")) ?? "",
    };
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
    propsToRead: NestedPropsToRead,
    importContext?: ImportContext
): Promise<Observed<ActionRandom>> {
    const actions: (Observed<Action> | null)[] = [];
    ctx.getItemSlot("Actions").click();
    await waitForMenu(ctx);
    for (const entry of await readActionList(ctx, { kind: "full", importContext })) {
        actions.push(entry.action);
    }
    await clickGoBack(ctx);
    return {
        type: "RANDOM",
        actions,
    };
}

async function writeRandom(
    ctx: TaskContext,
    action: ActionRandom,
    _current?: Observed<ActionRandom>,
    importContext?: ImportContext
): Promise<void> {
    if (action.actions.length === 0) return;

    ctx.getItemSlot("Actions").click();
    await waitForMenu(ctx);
    await syncActionList(ctx, action.actions, { importContext });
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

async function writePause(ctx: TaskContext, action: ActionPauseExecution): Promise<void> {
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

async function writeDropItem(
    ctx: TaskContext,
    action: ActionDropItem,
    _current?: Observed<ActionDropItem>,
    importContext?: ImportContext
): Promise<void> {
    await setItemValue(
        ctx,
        "Item",
        resolveActionItem(importContext, action.type, action.itemName)
    );

    if (action.location !== undefined) {
        if (action.location.type === "Custom Coordinates") {
            await openSubmenu(ctx, "Drop Location");
            const optionSlot = await getSlotPaginate(ctx, "Custom Coordinates");
            optionSlot.click();
            await enterValue(ctx, action.location.value);
            await waitForMenu(ctx);
        } else {
            await setSelectValue(ctx, "Drop Location", action.location.type);
        }
    }

    if (action.dropNaturally !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Drop Naturally"),
            action.dropNaturally
        );
    }

    if (action.disableMerging !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Disable Merging"),
            action.disableMerging
        );
    }

    if (action.despawnDurationTicks !== undefined) {
        await setStringValue(
            ctx,
            ctx.getItemSlot("Despawn Duration"),
            action.despawnDurationTicks
        );
    }

    if (action.pickupDelayTicks !== undefined) {
        await setStringValue(
            ctx,
            ctx.getItemSlot("Pickup Delay"),
            action.pickupDelayTicks
        );
    }

    if (action.prioritizePlayer !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Prioritize Player"),
            action.prioritizePlayer
        );
    }

    if (action.inventoryFallback !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getItemSlot("Inventory Fallback"),
            action.inventoryFallback
        );
    }
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
        read: readOpenMessage,
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

        clickPaginatedNextPage(ctx);
        await waitForMenu(ctx);
    }

    await goToActionPage(ctx, 1);
    const plan: NestedHydrationPlan =
        mode.kind === "full"
            ? buildFullHydrationPlan(observed)
            : createNestedHydrationPlan(observed, mode.desired);
    addScalarHydrationEntries(plan, observed);
    await hydrateNestedActions(ctx, plan, observed.length, mode.importContext);
    canonicalizeObservedActionItemNames(observed, mode.importContext);

    await goToActionPage(ctx, 1);
    return observed;
}

function addScalarHydrationEntries(
    plan: NestedHydrationPlan,
    observed: readonly ObservedActionSlot[]
): void {
    for (const entry of observed) {
        if (entry.action === null || plan.has(entry)) {
            continue;
        }

        if (shouldHydrateScalarAction(entry.action)) {
            plan.set(entry, new Set());
        }
    }
}

function shouldHydrateScalarAction(action: Observed<Action>): boolean {
    if (action.type === "MESSAGE") {
        return removedFormatting(action.message).trim().endsWith("...");
    }

    return false;
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

function canonicalizeObservedActionItemNames(
    observed: readonly ObservedActionSlot[],
    importContext?: ImportContext
): void {
    if (importContext === undefined) {
        return;
    }

    for (const entry of observed) {
        if (entry.action !== null) {
            canonicalizeActionItemName(entry.action, importContext);
        }
    }
}

function canonicalizeActionItemName(
    action: Observed<Action> | Action,
    importContext: ImportContext
): void {
    if (
        action.type === "GIVE_ITEM" ||
        action.type === "REMOVE_ITEM" ||
        action.type === "DROP_ITEM"
    ) {
        if (action.itemName !== undefined) {
            action.itemName = importContext.items.canonicalizeObservedName(
                action.itemName
            );
        }
    }

    if (action.type === "CONDITIONAL") {
        canonicalizeObservedConditionItemNames(action.conditions, importContext);
        for (const nested of action.ifActions) {
            if (nested !== null) {
                canonicalizeActionItemName(nested, importContext);
            }
        }
        for (const nested of action.elseActions) {
            if (nested !== null) {
                canonicalizeActionItemName(nested, importContext);
            }
        }
    }

    if (action.type === "RANDOM") {
        for (const nested of action.actions) {
            if (nested !== null) {
                canonicalizeActionItemName(nested, importContext);
            }
        }
    }
}

async function hydrateNestedActions(
    ctx: TaskContext,
    plan: NestedHydrationPlan,
    listLength: number,
    importContext?: ImportContext
): Promise<void> {
    for (const [entry, propsToRead] of plan) {
        await hydrateNestedAction(ctx, entry, propsToRead, listLength, importContext);
    }
}

async function hydrateNestedAction(
    ctx: TaskContext,
    entry: ObservedActionSlot,
    propsToRead: NestedPropsToRead,
    listLength: number,
    importContext?: ImportContext
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

        entry.action = await spec.read(ctx, propsToRead, importContext);
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
    current?: Observed<Action>,
    importContext?: ImportContext
): Promise<void> {
    const spec = getActionSpec(desired.type);
    // When adding new actions, read the current values to avoid
    // unnecessarily overwriting fields that aren't changing.
    let resolvedCurrent = current;

    if (resolvedCurrent === undefined && spec.read) {
        resolvedCurrent = await spec.read(ctx, new Set(), importContext);
    }

    if (!spec.write) {
        throw new Error(`Writing action "${desired.type}" is not implemented.`);
    }

    await spec.write(ctx, desired, resolvedCurrent, importContext);
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

export async function importAction(
    ctx: TaskContext,
    action: Action,
    importContext?: ImportContext
): Promise<void> {
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
        await writeOpenAction(ctx, action, undefined, importContext);
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
    diff: ActionListDiff,
    importContext?: ImportContext
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

            await writeOpenAction(ctx, op.desired, op.observed.action, importContext);
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

        await importAction(ctx, actionToImport, importContext);
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

const MAX_SYNC_DEBUG_DIFF_LINES = 40;

function formatDebugValue(value: unknown): string {
    if (value === undefined) return "<missing>";
    return JSON.stringify(value);
}

function pathForDiff(path: string): string {
    return path === "" ? "$" : path;
}

function collectDebugDiffLines(
    observed: unknown,
    desired: unknown,
    path: string = ""
): string[] {
    if (JSON.stringify(observed) === JSON.stringify(desired)) {
        return [];
    }

    if (Array.isArray(observed) || Array.isArray(desired)) {
        if (!Array.isArray(observed) || !Array.isArray(desired)) {
            return [
                `${pathForDiff(path)}: ${formatDebugValue(observed)} -> ${formatDebugValue(desired)}`,
            ];
        }

        const lines: string[] = [];
        if (observed.length !== desired.length) {
            lines.push(
                `${pathForDiff(path)}.length: ${observed.length} -> ${desired.length}`
            );
        }

        const length = Math.max(observed.length, desired.length);
        for (let i = 0; i < length; i++) {
            lines.push(
                ...collectDebugDiffLines(observed[i], desired[i], `${path}[${i}]`)
            );
        }
        return lines;
    }

    if (
        typeof observed === "object" &&
        observed !== null &&
        typeof desired === "object" &&
        desired !== null
    ) {
        const lines: string[] = [];
        const keys = new Set([
            ...Object.keys(observed as Record<string, unknown>),
            ...Object.keys(desired as Record<string, unknown>),
        ]);

        for (const key of [...keys].sort()) {
            const childPath = path === "" ? key : `${path}.${key}`;
            lines.push(
                ...collectDebugDiffLines(
                    (observed as Record<string, unknown>)[key],
                    (desired as Record<string, unknown>)[key],
                    childPath
                )
            );
        }
        return lines;
    }

    return [
        `${pathForDiff(path)}: ${formatDebugValue(observed)} -> ${formatDebugValue(desired)}`,
    ];
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
        const lines = collectDebugDiffLines(
            normalizeActionCompare(op.observed.action as Observed<Action>),
            normalizeActionCompare(op.desired)
        );
        for (const line of lines.slice(0, MAX_SYNC_DEBUG_DIFF_LINES)) {
            ctx.displayMessage(`&8  ${line}`);
        }
        if (lines.length > MAX_SYNC_DEBUG_DIFF_LINES) {
            ctx.displayMessage(
                `&8  ... ${lines.length - MAX_SYNC_DEBUG_DIFF_LINES} more difference(s)`
            );
        }
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
    importContext?: ImportContext;
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
        (await readActionList(ctx, {
            kind: "sync",
            desired,
            importContext: options?.importContext,
        }));
    canonicalizeObservedActionItemNames(observed, options?.importContext);
    const diff = diffActionList(observed, desired);
    logSyncState(ctx, diff);
    logSyncDebug(ctx, diff);
    await applyActionListDiff(ctx, observed, diff, options?.importContext);
    return { usedObserved: observed };
}
