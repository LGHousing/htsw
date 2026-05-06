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
import { type ItemRegistry, getMemoizedHousingUuid } from "../importables/itemRegistry";
import {
    clickGoBack,
    waitForMenu,
    timedWaitForMenu,
    getSlotPaginate,
    openSubmenu,
    enterValue,
    setStringValue,
    setStringOrPaginatedOptionValue,
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
import { getItemFromSnbt } from "../utils/nbt";
import { importableHash } from "../knowledge";
import { Diagnostic } from "htsw";
import {
    canonicalizeObservedConditionItemNames,
    readConditionList,
    syncConditionList,
} from "./conditions";
import {
    getEditFieldDiffs,
    normalizeActionCompare,
    normalizeConditionCompare,
} from "./compare";
import {
    ACTION_MAPPINGS,
    getActionFieldLabel,
    getNestedListFields,
    parseActionListItem,
    tryGetActionTypeFromDisplayName,
} from "./actionMappings";
import { diffActionList } from "./actions/diff";
import type {
    ActionListDiff,
    ActionListTrust,
    ActionListReadMode,
    ActionListOperation,
    NestedHydrationPlan,
    NestedListProp,
    NestedPropsToRead,
    NestedSummaries,
    Observed,
    ObservedActionSlot,
    ActionListProgressSink,
} from "./types";
import { createNestedHydrationPlan } from "./actions/hydrationPlan";
import { applyActionListTrust } from "./actions/trustHydration";
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
import {
    getActiveDiffSink,
    type ActionPath,
    type ImportDiffSink,
    type DiffSummary,
} from "./diffSink";
import {
    COST,
    actionListDiffApplyBudget,
    actionListRoughBudget,
    hydrationEntryBudget,
    moveBudget,
    scalarFieldEditBudget,
} from "./progress/costs";
import { timed } from "./progress/timing";

export { diffActionList };
export type {
    ActionListDiff,
    ActionListOperation,
    ActionListProgress,
    NestedListProp,
    NestedPropsToRead,
    ObservedActionSlot as ObservedAction,
    ActionListTrust,
} from "./types";

type ActionSpec<T extends Action = Action> = {
    displayName: string;
    read?: (
        ctx: TaskContext,
        propsToRead: NestedPropsToRead,
        itemRegistry?: ItemRegistry
    ) => Promise<Observed<T>>;
    write?: (
        ctx: TaskContext,
        desired: T,
        current?: Observed<T>,
        itemRegistry?: ItemRegistry
    ) => Promise<void>;
};

let currentWritingActionPath: ActionPath | null = null;

function actionPathForIndex(pathPrefix: string | undefined, index: number): ActionPath {
    return pathPrefix && pathPrefix.length > 0
        ? `${pathPrefix}.${index}`
        : String(index);
}

function withWritingActionPath<T>(path: ActionPath | null, fn: () => Promise<T>): Promise<T> {
    const previous = currentWritingActionPath;
    currentWritingActionPath = path;
    return fn().then(
        (value) => {
            currentWritingActionPath = previous;
            return value;
        },
        (err) => {
            currentWritingActionPath = previous;
            throw err;
        }
    );
}

type ActionSpecMap = {
    [K in Action["type"]]: ActionSpec<Extract<Action, { type: K }>>;
};

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

async function resolveActionItem(
    ctx: TaskContext,
    itemRegistry: ItemRegistry | undefined,
    action: Action,
    itemName: string
): Promise<Item> {
    if (itemRegistry === undefined) {
        throw new Error(
            `Cannot set item "${itemName}" for ${action.type}: no item registry is available.`
        );
    }

    const entry = itemRegistry.resolve(itemName, action);
    if (entry === undefined) {
        throw new Error(
            `Cannot set item "${itemName}" for ${action.type}: item fields resolve against top-level items[].name or direct .snbt paths.`
        );
    }

    const importable = entry.importable;
    const hasActions =
        importable !== undefined &&
        ((importable.leftClickActions !== undefined &&
            importable.leftClickActions.length > 0) ||
            (importable.rightClickActions !== undefined &&
                importable.rightClickActions.length > 0));
    if (!hasActions) {
        return entry.item;
    }

    const uuid = await getMemoizedHousingUuid(ctx, itemRegistry);
    const hash = importableHash(importable);
    const cachePath = `./htsw/.cache/${uuid}/items/${hash}.snbt`;
    if (!FileLib.exists(cachePath)) {
        throw new Error(
            `Cannot set item "${itemName}" for ${action.type}: it has click actions but isn't cached at ${cachePath}. ` +
                `Declare the item as a top-level importable in the same import.json so it imports first, ` +
                `or run /import on it before whatever references it.`
        );
    }
    const snbt = String(FileLib.read(cachePath));
    return getItemFromSnbt(snbt);
}

const ACTION_LIST_CONFIG: PaginatedListConfig = {
    label: "action",
    emptyPlaceholderName: "No Actions!",
};

async function readOpenConditional(
    ctx: TaskContext,
    propsToRead: NestedPropsToRead,
    itemRegistry?: ItemRegistry
): Promise<Observed<ActionConditional>> {
    const conditionsLabel = getActionFieldLabel("CONDITIONAL", "conditions");
    const matchAnyLabel = getActionFieldLabel("CONDITIONAL", "matchAny");
    const ifActionsLabel = getActionFieldLabel("CONDITIONAL", "ifActions");
    const elseActionsLabel = getActionFieldLabel("CONDITIONAL", "elseActions");

    let conditions: (Condition | null)[] = [];
    if (propsToRead.has("conditions")) {
        ctx.getMenuItemSlot(conditionsLabel).click();
        await waitForMenu(ctx);
        conditions = (await readConditionList(ctx, { itemRegistry })).map(
            (entry) => entry.condition
        );
        await clickGoBack(ctx);
    }

    const matchAny = readBooleanValue(ctx.getMenuItemSlot(matchAnyLabel)) ?? false;

    const ifActions: (Observed<Action> | null)[] = [];
    if (propsToRead.has("ifActions")) {
        ctx.getMenuItemSlot(ifActionsLabel).click();
        await waitForMenu(ctx);
        for (const entry of await readActionList(ctx, {
            kind: "full",
            itemRegistry,
        })) {
            ifActions.push(entry.action);
        }
        await clickGoBack(ctx);
    }

    const elseActions: (Observed<Action> | null)[] = [];
    if (propsToRead.has("elseActions")) {
        ctx.getMenuItemSlot(elseActionsLabel).click();
        await waitForMenu(ctx);
        for (const entry of await readActionList(ctx, {
            kind: "full",
            itemRegistry,
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
    itemRegistry?: ItemRegistry
): Promise<void> {
    if (
        !conditionListsEqual(current?.conditions, action.conditions) &&
        (action.conditions.length > 0 || (current?.conditions?.length ?? 0) > 0)
    ) {
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "conditions")).click();
        await waitForMenu(ctx);

        await syncConditionList(ctx, action.conditions, { itemRegistry });
        await clickGoBack(ctx);
    }

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "matchAny")),
        action.matchAny
    );

    if (
        !observedActionListsEqual(current?.ifActions, action.ifActions) &&
        (action.ifActions.length > 0 || (current?.ifActions?.length ?? 0) > 0)
    ) {
        ctx.displayMessage(`&7  [cond] syncing ifActions (${action.ifActions.length} desired)`);
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "ifActions")).click();
        await waitForMenu(ctx);
        await syncActionList(ctx, action.ifActions, {
            itemRegistry,
            pathPrefix: currentWritingActionPath === null
                ? undefined
                : `${currentWritingActionPath}.ifActions`,
        });
        await clickGoBack(ctx);
    }

    if (
        !observedActionListsEqual(current?.elseActions, action.elseActions) &&
        (action.elseActions.length > 0 || (current?.elseActions?.length ?? 0) > 0)
    ) {
        ctx.displayMessage(`&7  [cond] syncing elseActions (${action.elseActions.length} desired)`);
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "elseActions")).click();
        await waitForMenu(ctx);
        await syncActionList(ctx, action.elseActions, {
            itemRegistry,
            pathPrefix: currentWritingActionPath === null
                ? undefined
                : `${currentWritingActionPath}.elseActions`,
        });
        await clickGoBack(ctx);
    }
}

function observedActionListsEqual(
    observed: Array<Observed<Action> | null> | undefined,
    desired: readonly Action[]
): boolean {
    if (observed === undefined || observed.length !== desired.length) return false;
    for (let i = 0; i < desired.length; i++) {
        const observedAction = observed[i];
        if (observedAction === null) return false;
        if (
            JSON.stringify(normalizeActionCompare(observedAction)) !==
            JSON.stringify(normalizeActionCompare(desired[i]))
        ) {
            return false;
        }
    }
    return true;
}

function conditionListsEqual(
    observed: Array<Condition | null> | undefined,
    desired: readonly Condition[]
): boolean {
    if (observed === undefined || observed.length !== desired.length) return false;
    for (let i = 0; i < desired.length; i++) {
        const observedCondition = observed[i];
        if (observedCondition === null) return false;
        if (
            JSON.stringify(normalizeConditionCompare(observedCondition)) !==
            JSON.stringify(normalizeConditionCompare(desired[i]))
        ) {
            return false;
        }
    }
    return true;
}

async function writeSetGroup(ctx: TaskContext, action: ActionSetGroup): Promise<void> {
    await setSelectValue(ctx, getActionFieldLabel("SET_GROUP", "group"), action.group);

    if (action.demotionProtection !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("SET_GROUP", "demotionProtection")),
            action.demotionProtection
        );
    }
}

async function writeTitle(ctx: TaskContext, action: ActionTitle): Promise<void> {
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "title")),
        action.title
    );

    if (action.subtitle !== undefined) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "subtitle")),
            action.subtitle
        );
    }

    if (action.fadein !== undefined) {
        await setNumberValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "fadein")),
            action.fadein
        );
    }

    if (action.stay !== undefined) {
        await setNumberValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "stay")),
            action.stay
        );
    }

    if (action.fadeout !== undefined) {
        await setNumberValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "fadeout")),
            action.fadeout
        );
    }
}

async function writeActionBar(ctx: TaskContext, action: ActionActionBar): Promise<void> {
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("ACTION_BAR", "message")),
        action.message
    );
}

async function writeChangeMaxHealth(
    ctx: TaskContext,
    action: ActionChangeMaxHealth
): Promise<void> {
    await setSelectValue(ctx, getActionFieldLabel("CHANGE_MAX_HEALTH", "op"), action.op);
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("CHANGE_MAX_HEALTH", "amount")),
        action.amount
    );

    if (action.heal !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("CHANGE_MAX_HEALTH", "heal")),
            action.heal
        );
    }
}

async function writeGiveItem(
    ctx: TaskContext,
    action: ActionGiveItem,
    _current?: Observed<ActionGiveItem>,
    itemRegistry?: ItemRegistry
): Promise<void> {
    await setItemValue(
        ctx,
        getActionFieldLabel("GIVE_ITEM", "itemName"),
        await resolveActionItem(ctx, itemRegistry, action, action.itemName)
    );

    if (action.allowMultiple !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("GIVE_ITEM", "allowMultiple")),
            action.allowMultiple
        );
    }

    if (action.slot !== undefined) {
        await setSelectValue(
            ctx,
            getActionFieldLabel("GIVE_ITEM", "slot"),
            String(action.slot)
        );
    }

    if (action.replaceExisting !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("GIVE_ITEM", "replaceExisting")),
            action.replaceExisting
        );
    }
}

async function writeRemoveItem(
    ctx: TaskContext,
    action: ActionRemoveItem,
    _current?: Observed<ActionRemoveItem>,
    itemRegistry?: ItemRegistry
): Promise<void> {
    if (action.itemName !== undefined) {
        await setItemValue(
            ctx,
            getActionFieldLabel("REMOVE_ITEM", "itemName"),
            await resolveActionItem(ctx, itemRegistry, action, action.itemName)
        );
    }
}

async function writeSendMessage(
    ctx: TaskContext,
    action: ActionSendMessage
): Promise<void> {
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("MESSAGE", "message")),
        action.message
    );
}

async function readOpenMessage(ctx: TaskContext): Promise<Observed<ActionSendMessage>> {
    return {
        type: "MESSAGE",
        message:
            readStringValue(ctx.getMenuItemSlot(getActionFieldLabel("MESSAGE", "message"))) ??
            "",
    };
}

async function writeApplyPotionEffect(
    ctx: TaskContext,
    action: ActionApplyPotionEffect
): Promise<void> {
    await setSelectValue(
        ctx,
        getActionFieldLabel("APPLY_POTION_EFFECT", "effect"),
        action.effect
    );
    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("APPLY_POTION_EFFECT", "duration")),
        action.duration
    );

    if (action.level !== undefined) {
        await setNumberValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("APPLY_POTION_EFFECT", "level")),
            action.level
        );
    }

    if (action.override !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("APPLY_POTION_EFFECT", "override")),
            action.override
        );
    }

    if (action.showIcon !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("APPLY_POTION_EFFECT", "showIcon")),
            action.showIcon
        );
    }
}

async function writeGiveExperienceLevels(
    ctx: TaskContext,
    action: ActionGiveExperienceLevels
): Promise<void> {
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("GIVE_EXPERIENCE_LEVELS", "amount")),
        action.amount
    );
}

async function writeSendToLobby(
    ctx: TaskContext,
    action: ActionSendToLobby
): Promise<void> {
    if (action.lobby !== undefined) {
        await setSelectValue(
            ctx,
            getActionFieldLabel("SEND_TO_LOBBY", "lobby"),
            action.lobby
        );
    }
}

const VAR_HOLDER_OPTIONS = ["Player", "Global", "Team"] as const;

async function writeChangeVar(ctx: TaskContext, action: ActionChangeVar): Promise<void> {
    if (action.holder) {
        await setCycleValue(
            ctx,
            getActionFieldLabel("CHANGE_VAR", "holder"),
            VAR_HOLDER_OPTIONS,
            action.holder.type
        );
        if (action.holder.type === "Team" && action.holder.team !== undefined) {
            await setSelectValue(ctx, "Team", action.holder.team);
        }
    }

    if (action.key) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("CHANGE_VAR", "key")),
            action.key
        );
    }

    if (action.op) {
        await setSelectValue(ctx, getActionFieldLabel("CHANGE_VAR", "op"), action.op);
    }

    if (action.value) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("CHANGE_VAR", "value")),
            action.value
        );
    }

    if (action.unset !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("CHANGE_VAR", "unset")),
            action.unset
        );
    }
}

async function writeTeleport(ctx: TaskContext, action: ActionTeleport): Promise<void> {
    const locationLabel = getActionFieldLabel("TELEPORT", "location");
    if (action.location.type === "Custom Coordinates") {
        await openSubmenu(ctx, locationLabel);
        const optionSlot = await getSlotPaginate(ctx, "Custom Coordinates");
        optionSlot.click();
        await enterValue(ctx, action.location.value);
        await waitForMenu(ctx);
    } else {
        await setSelectValue(ctx, locationLabel, action.location.type);
    }

    if (action.preventTeleportInsideBlocks !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(
                getActionFieldLabel("TELEPORT", "preventTeleportInsideBlocks")
            ),
            action.preventTeleportInsideBlocks
        );
    }
}

async function writeFailParkour(
    ctx: TaskContext,
    action: ActionFailParkour
): Promise<void> {
    if (action.message !== undefined) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("FAIL_PARKOUR", "message")),
            action.message
        );
    }
}

async function writePlaySound(ctx: TaskContext, action: ActionPlaySound): Promise<void> {
    const soundLabel = getActionFieldLabel("PLAY_SOUND", "sound");
    const currentSound = readStringValue(ctx.getMenuItemSlot(soundLabel));
    if (currentSound !== action.sound) {
        await openSubmenu(ctx, soundLabel);
        const customSoundSlot = await getSlotPaginate(ctx, "Custom Sound");
        customSoundSlot.click();
        await enterValue(ctx, action.sound);
        await waitForMenu(ctx);
    }

    if (action.volume !== undefined) {
        await setNumberValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("PLAY_SOUND", "volume")),
            action.volume
        );
    }

    if (action.pitch !== undefined) {
        await setNumberValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("PLAY_SOUND", "pitch")),
            action.pitch
        );
    }

    if (action.location !== undefined) {
        const locationLabel = getActionFieldLabel("PLAY_SOUND", "location");
        if (action.location.type === "Custom Coordinates") {
            await openSubmenu(ctx, locationLabel);
            const optionSlot = await getSlotPaginate(ctx, "Custom Coordinates");
            optionSlot.click();
            await enterValue(ctx, action.location.value);
            await waitForMenu(ctx);
        } else {
            await setSelectValue(ctx, locationLabel, action.location.type);
        }
    }
}

async function writeSetCompassTarget(
    ctx: TaskContext,
    action: ActionSetCompassTarget
): Promise<void> {
    const locationLabel = getActionFieldLabel("SET_COMPASS_TARGET", "location");
    if (action.location.type === "Custom Coordinates") {
        await openSubmenu(ctx, locationLabel);
        const optionSlot = await getSlotPaginate(ctx, "Custom Coordinates");
        optionSlot.click();
        await enterValue(ctx, action.location.value);
        await waitForMenu(ctx);
    } else {
        await setSelectValue(ctx, locationLabel, action.location.type);
    }
}

async function writeSetGamemode(
    ctx: TaskContext,
    action: ActionSetGamemode
): Promise<void> {
    await setSelectValue(
        ctx,
        getActionFieldLabel("SET_GAMEMODE", "gamemode"),
        action.gamemode
    );
}

async function writeChangeHealth(
    ctx: TaskContext,
    action: ActionChangeHealth
): Promise<void> {
    await setSelectValue(ctx, getActionFieldLabel("CHANGE_HEALTH", "op"), action.op);
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("CHANGE_HEALTH", "amount")),
        action.amount
    );
}

async function writeChangeHunger(
    ctx: TaskContext,
    action: ActionChangeHunger
): Promise<void> {
    await setSelectValue(ctx, getActionFieldLabel("CHANGE_HUNGER", "op"), action.op);
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("CHANGE_HUNGER", "amount")),
        action.amount
    );
}

async function readOpenRandom(
    ctx: TaskContext,
    propsToRead: NestedPropsToRead,
    itemRegistry?: ItemRegistry
): Promise<Observed<ActionRandom>> {
    const actions: (Observed<Action> | null)[] = [];
    ctx.getMenuItemSlot(getActionFieldLabel("RANDOM", "actions")).click();
    await waitForMenu(ctx);
    for (const entry of await readActionList(ctx, { kind: "full", itemRegistry })) {
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
    current?: Observed<ActionRandom>,
    itemRegistry?: ItemRegistry
): Promise<void> {
    if (observedActionListsEqual(current?.actions, action.actions)) return;
    if (action.actions.length === 0 && (current?.actions?.length ?? 0) === 0) return;

    ctx.getMenuItemSlot(getActionFieldLabel("RANDOM", "actions")).click();
    await waitForMenu(ctx);
    await syncActionList(ctx, action.actions, {
        itemRegistry,
        pathPrefix: currentWritingActionPath === null
            ? undefined
            : `${currentWritingActionPath}.actions`,
    });
    await clickGoBack(ctx);
}

async function writeFunction(ctx: TaskContext, action: ActionFunction): Promise<void> {
    await setStringOrPaginatedOptionValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("FUNCTION", "function")),
        action.function
    );

    if (action.global !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("FUNCTION", "global")),
            action.global
        );
    }
}

async function writeApplyInventoryLayout(
    ctx: TaskContext,
    action: ActionApplyInventoryLayout
): Promise<void> {
    await setSelectValue(
        ctx,
        getActionFieldLabel("APPLY_INVENTORY_LAYOUT", "layout"),
        action.layout
    );
}

async function writeEnchantHeldItem(
    ctx: TaskContext,
    action: ActionEnchantHeldItem
): Promise<void> {
    await setSelectValue(
        ctx,
        getActionFieldLabel("ENCHANT_HELD_ITEM", "enchant"),
        action.enchant
    );
    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("ENCHANT_HELD_ITEM", "level")),
        action.level
    );
}

async function writePause(ctx: TaskContext, action: ActionPauseExecution): Promise<void> {
    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("PAUSE", "ticks")),
        action.ticks
    );
}

async function writeSetTeam(ctx: TaskContext, action: ActionSetTeam): Promise<void> {
    await setSelectValue(ctx, getActionFieldLabel("SET_TEAM", "team"), action.team);
}

async function writeDisplayMenu(
    ctx: TaskContext,
    action: ActionDisplayMenu
): Promise<void> {
    await setSelectValue(ctx, getActionFieldLabel("SET_MENU", "menu"), action.menu);
}

async function writeDropItem(
    ctx: TaskContext,
    action: ActionDropItem,
    _current?: Observed<ActionDropItem>,
    itemRegistry?: ItemRegistry
): Promise<void> {
    await setItemValue(
        ctx,
        getActionFieldLabel("DROP_ITEM", "itemName"),
        await resolveActionItem(ctx, itemRegistry, action, action.itemName)
    );

    if (action.location !== undefined) {
        const locationLabel = getActionFieldLabel("DROP_ITEM", "location");
        if (action.location.type === "Custom Coordinates") {
            await openSubmenu(ctx, locationLabel);
            const optionSlot = await getSlotPaginate(ctx, "Custom Coordinates");
            optionSlot.click();
            await enterValue(ctx, action.location.value);
            await waitForMenu(ctx);
        } else {
            await setSelectValue(ctx, locationLabel, action.location.type);
        }
    }

    if (action.dropNaturally !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "dropNaturally")),
            action.dropNaturally
        );
    }

    if (action.disableMerging !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "disableMerging")),
            action.disableMerging
        );
    }

    if (action.despawnDurationTicks !== undefined) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "despawnDurationTicks")),
            action.despawnDurationTicks
        );
    }

    if (action.pickupDelayTicks !== undefined) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "pickupDelayTicks")),
            action.pickupDelayTicks
        );
    }

    if (action.prioritizePlayer !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "prioritizePlayer")),
            action.prioritizePlayer
        );
    }

    if (action.inventoryFallback !== undefined) {
        await setBooleanValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "inventoryFallback")),
            action.inventoryFallback
        );
    }
}

async function writeSetVelocity(
    ctx: TaskContext,
    action: ActionSetVelocity
): Promise<void> {
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("SET_VELOCITY", "x")),
        action.x
    );
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("SET_VELOCITY", "y")),
        action.y
    );
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("SET_VELOCITY", "z")),
        action.z
    );
}

async function writeLaunch(ctx: TaskContext, action: ActionLaunch): Promise<void> {
    const locationLabel = getActionFieldLabel("LAUNCH", "location");
    if (action.location.type === "Custom Coordinates") {
        await openSubmenu(ctx, locationLabel);
        const optionSlot = await getSlotPaginate(ctx, "Custom Coordinates");
        optionSlot.click();
        await enterValue(ctx, action.location.value);
        await waitForMenu(ctx);
    } else {
        await setSelectValue(ctx, locationLabel, action.location.type);
    }
    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("LAUNCH", "strength")),
        action.strength
    );
}

async function writeSetPlayerWeather(
    ctx: TaskContext,
    action: ActionSetPlayerWeather
): Promise<void> {
    await setSelectValue(
        ctx,
        getActionFieldLabel("SET_PLAYER_WEATHER", "weather"),
        action.weather
    );
}

async function writeSetPlayerTime(
    ctx: TaskContext,
    action: ActionSetPlayerTime
): Promise<void> {
    await setCycleValue(
        ctx,
        getActionFieldLabel("SET_PLAYER_TIME", "time"),
        [action.time],
        action.time
    );
}

async function writeToggleNametagDisplay(
    ctx: TaskContext,
    action: ActionToggleNametagDisplay
): Promise<void> {
    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("TOGGLE_NAMETAG_DISPLAY", "displayNametag")),
        action.displayNametag
    );
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
    const slots = getVisiblePaginatedItemSlots(ctx).filter(
        (slot) => !isEmptyPaginatedPlaceholder(slot, ACTION_LIST_CONFIG)
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
    const progress = mode.onProgress;
    const desiredTotal =
        mode.kind === "sync" ? Math.max(1, mode.desired.length) : 1;
    const roughEstimate =
        mode.kind === "sync" ? Math.max(1, actionListRoughBudget(mode.desired)) : 1;
    let readEstimatedCompleted = 0;
    progress?.({
        phase: "reading",
        completed: 0,
        total: desiredTotal,
        label: "reading housing state",
        estimatedCompleted: 0,
        estimatedTotal: roughEstimate,
        confidence: "rough",
    });
    getActiveDiffSink()?.phase("reading housing state");
    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    const observed: ObservedActionSlot[] = [];

    while (true) {
        const pageObserved = await readActionsListPage(ctx);
        for (const entry of pageObserved) {
            entry.index = observed.length;
            observed.push(entry);
        }
        progress?.({
            phase: "reading",
            completed: observed.length,
            total: Math.max(desiredTotal, observed.length),
            label: `${observed.length} actions read`,
            estimatedCompleted: readEstimatedCompleted,
            estimatedTotal: Math.max(roughEstimate, readEstimatedCompleted),
            confidence: "rough",
        });

        const state = getCurrentPaginatedListPageState(ctx, ACTION_LIST_CONFIG);
        if (!state.hasNext) {
            break;
        }

        clickPaginatedNextPage(ctx);
        await timedWaitForMenu(ctx, "pageTurnWait");
        readEstimatedCompleted += COST.pageTurnWait;
    }

    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    const plan: NestedHydrationPlan =
        mode.kind === "full"
            ? buildFullHydrationPlan(observed)
            : createNestedHydrationPlan(observed, mode.desired);
    addScalarHydrationEntries(plan, observed);
    if (mode.kind === "sync" && mode.trust !== undefined) {
        applyActionListTrust(observed, mode.desired, plan, mode.trust);
    }
    await hydrateNestedActions(ctx, plan, observed.length, mode.itemRegistry, progress, readEstimatedCompleted);
    canonicalizeObservedActionItemNames(observed, mode.itemRegistry);

    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
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
    itemRegistry?: ItemRegistry
): void {
    if (itemRegistry === undefined) {
        return;
    }

    for (const entry of observed) {
        if (entry.action !== null) {
            canonicalizeActionItemName(entry.action, itemRegistry);
        }
    }
}

function canonicalizeActionItemName(
    action: Observed<Action> | Action,
    itemRegistry: ItemRegistry
): void {
    if (
        action.type === "GIVE_ITEM" ||
        action.type === "REMOVE_ITEM" ||
        action.type === "DROP_ITEM"
    ) {
        if (action.itemName !== undefined) {
            action.itemName = itemRegistry.canonicalizeObservedName(action.itemName);
        }
    }

    if (action.type === "CONDITIONAL") {
        canonicalizeObservedConditionItemNames(action.conditions, itemRegistry);
        for (const nested of action.ifActions) {
            if (nested !== null) {
                canonicalizeActionItemName(nested, itemRegistry);
            }
        }
        for (const nested of action.elseActions) {
            if (nested !== null) {
                canonicalizeActionItemName(nested, itemRegistry);
            }
        }
    }

    if (action.type === "RANDOM") {
        for (const nested of action.actions) {
            if (nested !== null) {
                canonicalizeActionItemName(nested, itemRegistry);
            }
        }
    }
}

async function hydrateNestedActions(
    ctx: TaskContext,
    plan: NestedHydrationPlan,
    listLength: number,
    itemRegistry?: ItemRegistry,
    progress?: ActionListProgressSink,
    baseEstimatedCompleted: number = 0
): Promise<void> {
    let completed = 0;
    const total = plan.size;
    let completedBudget = 0;
    let totalBudget = 0;
    plan.forEach((propsToRead, entry) => {
        totalBudget += hydrationEntryBudget(entry, propsToRead);
    });
    for (const [entry, propsToRead] of plan) {
        progress?.({
            phase: "hydrating",
            completed,
            total,
            label: `reading nested ${actionLogLabel(entry.action)}`,
            estimatedCompleted: baseEstimatedCompleted + completedBudget,
            estimatedTotal: baseEstimatedCompleted + totalBudget,
            confidence: "informed",
        });
        getActiveDiffSink()?.phase(`reading nested ${actionLogLabel(entry.action)}`);
        const beforeBudget = hydrationEntryBudget(entry, propsToRead);
        await hydrateNestedAction(ctx, entry, propsToRead, listLength, itemRegistry);
        completedBudget += beforeBudget;
        completed++;
        progress?.({
            phase: "hydrating",
            completed,
            total,
            label: `${completed}/${total} nested actions read`,
            estimatedCompleted: baseEstimatedCompleted + completedBudget,
            estimatedTotal: baseEstimatedCompleted + totalBudget,
            confidence: "informed",
        });
    }
}

async function hydrateNestedAction(
    ctx: TaskContext,
    entry: ObservedActionSlot,
    propsToRead: NestedPropsToRead,
    listLength: number,
    itemRegistry?: ItemRegistry
): Promise<void> {
    if (entry.action === null) {
        return;
    }

    const note = entry.action.note;
    try {
        await goToPaginatedListPage(ctx, getPaginatedListPageForIndex(entry.index), ACTION_LIST_CONFIG);
        const actionSlot = await getPaginatedListSlotAtIndex(ctx, entry.index, listLength, ACTION_LIST_CONFIG);
        entry.slot = actionSlot;
        entry.slotId = actionSlot.getSlotId();

        actionSlot.click();
        await timedWaitForMenu(ctx, "menuClickWait");
        const spec = getActionSpec(entry.action.type);
        if (!spec.read) {
            throw new Error(`Reading action "${entry.action.type}" is not implemented.`);
        }

        entry.action = await spec.read(ctx, propsToRead, itemRegistry);
        entry.nestedReadState = "full";
        if (note) {
            entry.action.note = note;
        }
        await clickGoBack(ctx);
    } catch (error) {
        ctx.displayMessage(
            `&7[action-read] &cFailed to read nested action at index ${entry.index} (${entry.action.type}): ${error}`
        );
        if (ctx.tryGetMenuItemSlot("Go Back") !== null) {
            await clickGoBack(ctx);
        }
    }
}

async function writeOpenAction(
    ctx: TaskContext,
    desired: Action,
    current?: Observed<Action>,
    itemRegistry?: ItemRegistry
): Promise<void> {
    const spec = getActionSpec(desired.type);
    // When adding new actions, read the current values to avoid
    // unnecessarily overwriting fields that aren't changing.
    let resolvedCurrent = current;

    if (resolvedCurrent === undefined && spec.read) {
        resolvedCurrent = await spec.read(ctx, new Set(), itemRegistry);
    }

    if (!spec.write) {
        throw new Error(`Writing action "${desired.type}" is not implemented.`);
    }

    await spec.write(ctx, desired, resolvedCurrent, itemRegistry);
}

async function deleteObservedAction(
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<void> {
    const slot = await getPaginatedListSlotAtIndex(ctx, index, listLength, ACTION_LIST_CONFIG);
    slot.click(MouseButton.RIGHT);
    await timedWaitForMenu(ctx, "menuClickWait");
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

export async function importAction(
    ctx: TaskContext,
    action: Action,
    itemRegistry?: ItemRegistry
): Promise<void> {
    ctx.getMenuItemSlot("Add Action").click();
    await timedWaitForMenu(ctx, "menuClickWait");

    const spec = getActionSpec(action.type);
    const displayName = spec.displayName;

    const slot = await getSlotPaginate(ctx, displayName);

    if (isLimitExceeded(slot)) {
        throw Diagnostic.error(`Maximum amount of ${displayName} actions exceeded`);
    }

    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");

    // No-field actions (e.g. Kill Player, Exit) add directly to the list
    // without opening an editor.
    if (spec.write) {
        await writeOpenAction(ctx, action, undefined, itemRegistry);
        await clickGoBack(ctx);
    }

    if (action.note) {
        const itemSlots = getVisiblePaginatedItemSlots(ctx);
        const addedSlot = itemSlots[itemSlots.length - 1];
        if (addedSlot) {
            await setListItemNote(ctx, addedSlot, action.note);
        }
    }
}

async function applyActionListDiff(
    ctx: TaskContext,
    observed: ObservedActionSlot[],
    desired: Action[],
    diff: ActionListDiff,
    itemRegistry?: ItemRegistry,
    progress?: ActionListProgressSink,
    pathPrefix?: string
): Promise<void> {
    const sink = getActiveDiffSink();
    await applyActionListDiffInner(
        ctx,
        observed,
        desired,
        diff,
        sink,
        itemRegistry,
        progress,
        pathPrefix
    );
}

function srcIndexForOp(op: ActionListOperation, desired: Action[]): number {
    if (op.kind === "add" || op.kind === "move") return op.toIndex;
    if (op.kind === "edit") return desired.indexOf(op.desired);
    return -1; // delete: action isn't in source
}

function opLabel(op: ActionListOperation): string {
    if (op.kind === "delete") return `delete ${actionLogLabel(op.observed.action)}`;
    if (op.kind === "edit") return `edit → ${actionLogLabel(op.desired)}`;
    if (op.kind === "move") return `move ${actionLogLabel(op.action)} → #${op.toIndex + 1}`;
    return `add ${actionLogLabel(op.desired)}`;
}

function opDetail(op: ActionListOperation): string {
    if (op.kind === "edit") return editDiffSummary(op);
    if (op.kind === "move") return `#${op.observed.index + 1} -> #${op.toIndex + 1}`;
    if (op.kind === "add") return "add source action";
    return "delete Housing-only action";
}

function editOperationFieldBudget(
    op: Extract<ActionListOperation, { kind: "edit" }>
): number {
    const { fieldDiffs } = getEditFieldDiffs(op);
    return scalarFieldEditBudget(fieldDiffs);
}

function operationApplyBudget(
    op: ActionListOperation,
    desiredLength: number
): number {
    if (op.kind === "delete") return COST.menuClickWait;
    if (op.kind === "move") {
        return moveBudget(op.observed.index, op.toIndex, desiredLength);
    }
    if (op.kind === "add") {
        const fakeDiff: ActionListDiff = { operations: [op] };
        return actionListDiffApplyBudget(fakeDiff, editOperationFieldBudget, desiredLength);
    }
    const fakeDiff: ActionListDiff = { operations: [op] };
    return actionListDiffApplyBudget(fakeDiff, editOperationFieldBudget, desiredLength);
}

function summarizeDiff(
    diff: ActionListDiff,
    desiredLength: number,
    desired: Action[]
): DiffSummary {
    let edits = 0;
    let moves = 0;
    let adds = 0;
    let deletes = 0;
    const touched = new Set<number>();
    for (const op of diff.operations) {
        const idx = srcIndexForOp(op, desired);
        if (idx >= 0) touched.add(idx);
        if (op.kind === "edit") edits++;
        else if (op.kind === "move") moves++;
        else if (op.kind === "add") adds++;
        else deletes++;
    }
    return {
        matches: Math.max(0, desiredLength - touched.size),
        edits,
        moves,
        adds,
        deletes,
    };
}

async function applyActionListDiffInner(
    ctx: TaskContext,
    observed: ObservedActionSlot[],
    desired: Action[],
    diff: ActionListDiff,
    sink: ImportDiffSink | null,
    itemRegistry?: ItemRegistry,
    progress?: ActionListProgressSink,
    pathPrefix?: string
): Promise<void> {
    const summary = summarizeDiff(diff, desired.length, desired);
    const plannedApplyBudget = actionListDiffApplyBudget(
        diff,
        editOperationFieldBudget,
        desired.length
    );
    if (sink !== null) {
        sink.summary(summary);
        sink.phase("computed diff");
        for (const op of diff.operations) {
            const idx = srcIndexForOp(op, desired);
            if (idx >= 0) {
                sink.planOp(actionPathForIndex(pathPrefix, idx), op.kind, opLabel(op), opDetail(op));
            } else if (op.kind === "delete") {
                sink.deleteOp(op.observed.index, opLabel(op), opDetail(op));
            }
        }
    }
    progress?.({
        phase: "diffing",
        completed: 1,
        total: 1,
        label: `${summary.edits} edits · ${summary.adds} adds · ${summary.deletes} deletes · ${summary.moves} moves`,
        estimatedCompleted: 0,
        estimatedTotal: plannedApplyBudget,
        confidence: "planned",
    });

    // Pre-mark already-matching desired actions. Anything not touched by an
    // op is "match" (white) from the start; ops will paint their own state
    // on completion.
    if (sink !== null) {
        const touched = new Set<number>();
        for (const op of diff.operations) {
            const idx = srcIndexForOp(op, desired);
            if (idx >= 0) touched.add(idx);
        }
        for (let i = 0; i < desired.length; i++) {
            if (!touched.has(i)) sink.markMatch(actionPathForIndex(pathPrefix, i));
        }
    }

    if (diff.operations.length === 0) {
        if (sink !== null) sink.end();
        return;
    }

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

    let appliedBudget = 0;

    // Deletes first (reverse order so indices stay valid), then refresh slot refs.
    if (deletes.length > 0) {
        deletes.sort((a, b) => b.observed.index - a.observed.index);
        const currentObserved = [...observed];

        for (let i = 0; i < deletes.length; i++) {
            const op = deletes[i];
            const index = currentObserved.indexOf(op.observed);
            if (index === -1) {
                continue;
            }

            progress?.({
                phase: "applying",
                completed: i,
                total: diff.operations.length,
                label: opLabel(op),
                estimatedCompleted: appliedBudget,
                estimatedTotal: plannedApplyBudget,
                confidence: "planned",
            });
            if (sink !== null) sink.phase(opLabel(op));
            await deleteObservedAction(ctx, index, currentObserved.length);
            appliedBudget += operationApplyBudget(op, desired.length);
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
    let appliedOps = deletes.length;
    for (const op of edits) {
        const currentIndex = remainingObserved.indexOf(op.observed);
        if (currentIndex === -1) {
            continue;
        }

        const srcIdx = srcIndexForOp(op, desired);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (sink !== null && srcPath !== null) sink.beginOp(srcPath, "edit", opLabel(op));
        progress?.({
            phase: "applying",
            completed: appliedOps,
            total: diff.operations.length,
            label: opLabel(op),
            estimatedCompleted: appliedBudget,
            estimatedTotal: plannedApplyBudget,
            confidence: "planned",
        });
        appliedOps++;

        const actionSlot = await getPaginatedListSlotAtIndex(
            ctx,
            currentIndex,
            remainingObserved.length,
            ACTION_LIST_CONFIG
        );
        op.observed.slot = actionSlot;
        op.observed.slotId = actionSlot.getSlotId();

        if (op.noteOnly) {
            await setListItemNote(ctx, actionSlot, op.desired.note);
            appliedBudget += operationApplyBudget(op, desired.length);
            if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "edit");
            continue;
        }

        const spec = getActionSpec(op.desired.type);
        if (spec.write) {
            actionSlot.click();
            await timedWaitForMenu(ctx, "menuClickWait");

            if (!op.observed.action) {
                throw new Error(
                    "Observed action should always be present for edit operations."
                );
            }
            const currentAction = op.observed.action;

            await withWritingActionPath(srcPath, () =>
                writeOpenAction(ctx, op.desired, currentAction, itemRegistry)
            );
            await clickGoBack(ctx);
        }

        await setListItemNote(ctx, actionSlot, op.desired.note);
        appliedBudget += operationApplyBudget(op, desired.length);
        if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "edit");
    }

    moves.sort((a, b) => a.toIndex - b.toIndex);
    for (const op of moves) {
        const fromIndex = remainingObserved.indexOf(op.observed);
        if (fromIndex === -1) {
            continue;
        }

        const srcIdx = srcIndexForOp(op, desired);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (sink !== null && srcPath !== null) sink.beginOp(srcPath, "move", opLabel(op));
        progress?.({
            phase: "applying",
            completed: appliedOps,
            total: diff.operations.length,
            label: opLabel(op),
            estimatedCompleted: appliedBudget,
            estimatedTotal: plannedApplyBudget,
            confidence: "planned",
        });
        appliedOps++;

        await moveActionToIndex(ctx, fromIndex, op.toIndex, remainingObserved.length);
        appliedBudget += operationApplyBudget(op, desired.length);

        remainingObserved.splice(fromIndex, 1);
        remainingObserved.splice(op.toIndex, 0, op.observed);
        for (let i = 0; i < remainingObserved.length; i++) {
            remainingObserved[i].index = i;
        }
        if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "match");
    }

    adds.sort((a, b) => a.toIndex - b.toIndex);
    let currentLength = remainingObserved.length;
    for (const op of adds) {
        const srcIdx = srcIndexForOp(op, desired);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (sink !== null && srcPath !== null) sink.beginOp(srcPath, "add", opLabel(op));
        progress?.({
            phase: "applying",
            completed: appliedOps,
            total: diff.operations.length,
            label: opLabel(op),
            estimatedCompleted: appliedBudget,
            estimatedTotal: plannedApplyBudget,
            confidence: "planned",
        });
        appliedOps++;

        const actionToImport =
            op.desired.note === undefined
                ? op.desired
                : ({ ...op.desired, note: undefined } as Action);

        await withWritingActionPath(srcPath, () => importAction(ctx, actionToImport, itemRegistry));
        await moveActionToIndex(ctx, currentLength, op.toIndex, currentLength + 1);

        const insertedAction: ObservedActionSlot = {
            index: op.toIndex,
            slotId: -1,
            slot: null as never,
            action: op.desired,
        };
        remainingObserved.splice(op.toIndex, 0, insertedAction);
        currentLength += 1;
        for (let i = 0; i < remainingObserved.length; i++) {
            remainingObserved[i].index = i;
        }

        if (op.desired.note !== undefined) {
            const addedSlot = await getPaginatedListSlotAtIndex(ctx, op.toIndex, currentLength, ACTION_LIST_CONFIG);
            await setListItemNote(ctx, addedSlot, op.desired.note);
        }
        appliedBudget += operationApplyBudget(op, desired.length);
        if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "add");
    }

    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    progress?.({
        phase: "applying",
        completed: diff.operations.length,
        total: diff.operations.length,
        label: "applied action diff",
        estimatedCompleted: plannedApplyBudget,
        estimatedTotal: plannedApplyBudget,
        confidence: "planned",
    });

    if (sink !== null) sink.end();
}

function actionLogLabel(action: Action | Observed<Action> | null | undefined): string {
    if (action === null || action === undefined) {
        return "Unknown Action";
    }

    if (action.type === "CONDITIONAL") {
        return "CONDITIONAL";
    }

    if (action.type === "RANDOM") {
        const ac =
            (action.actions as unknown as readonly unknown[] | undefined)?.length ?? "?";
        return `RANDOM (${ac})`;
    }

    if (action.type === "CHANGE_VAR") {
        const holder = action.holder?.type === "Global" ? "g/" : action.holder?.type === "Team" ? "t/" : "";
        return `CHANGE_VAR ${holder}${action.key ?? "?"} ${action.op ?? "="} ${action.value ?? "?"}`;
    }

    if (action.type === "MESSAGE") {
        const msg = action.message ?? "";
        const short = msg.length > 30 ? msg.slice(0, 27) + "..." : msg;
        return `MESSAGE "${short}"`;
    }

    if (action.type === "FUNCTION") {
        return `FUNCTION "${action.function ?? "?"}"`;
    }

    if (action.type === "GIVE_ITEM" || action.type === "REMOVE_ITEM" || action.type === "DROP_ITEM") {
        return `${action.type} "${action.itemName ?? "?"}"`;
    }

    if (action.type === "SET_TEAM") {
        return `SET_TEAM "${action.team ?? "None"}"`;
    }

    return action.type;
}

function shortVal(v: unknown): string {
    if (v === undefined) return "unset";
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string") {
        const quoted = `"${v}"`;
        return quoted.length > 35 ? `"${v.slice(0, 30)}..."` : quoted;
    }
    if (typeof v === "object") {
        const json = JSON.stringify(v);
        return json.length > 35 ? json.slice(0, 32) + "..." : json;
    }
    const s = String(v);
    return s.length > 35 ? s.slice(0, 32) + "..." : s;
}

function editDiffSummary(op: Extract<ActionListOperation, { kind: "edit" }>): string {
    const { fieldDiffs, noteDiffers } = getEditFieldDiffs(op);
    const parts: string[] = [];
    for (const diff of fieldDiffs) {
        parts.push(`${diff.prop} ${shortVal(diff.observed)} -> ${shortVal(diff.desired)}`);
    }
    if (noteDiffers) parts.push("note changed");
    return parts.join(", ");
}

function logSyncState(ctx: TaskContext, diff: ActionListDiff): void {
    if (diff.operations.length === 0) {
        ctx.displayMessage(`&7[sync] &aUp to date.`);
        return;
    }

    const deletes = diff.operations.filter((op) => op.kind === "delete");
    const edits = diff.operations.filter((op) => op.kind === "edit");
    const moves = diff.operations.filter((op) => op.kind === "move");
    const adds = diff.operations.filter((op) => op.kind === "add");

    ctx.displayMessage(
        `&7[sync] &d${diff.operations.length} ops &7(&c${deletes.length} del &6${edits.length} edit &e${moves.length} move &a${adds.length} add&7)`
    );

    for (const op of diff.operations) {
        switch (op.kind) {
            case "delete":
                ctx.displayMessage(
                    `&7  &c-DEL [${op.observed.index}] ${actionLogLabel(op.observed.action)}`
                );
                break;
            case "edit":
                if (op.noteOnly) {
                    ctx.displayMessage(
                        `&7  &6~NOTE [${op.observed.index}] ${actionLogLabel(op.observed.action)}`
                    );
                } else {
                    ctx.displayMessage(
                        `&7  &6~EDIT [${op.observed.index}] ${actionLogLabel(op.observed.action)}: ${editDiffSummary(op)}`
                    );
                }
                break;
            case "add":
                ctx.displayMessage(
                    `&7  &a+ADD [${op.toIndex}] ${actionLogLabel(op.desired)}`
                );
                break;
            case "move":
                ctx.displayMessage(
                    `&7  &e>MOV [${op.observed.index} -> ${op.toIndex}] ${actionLogLabel(op.action)}`
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
    itemRegistry?: ItemRegistry;
    trust?: ActionListTrust;
    onProgress?: ActionListProgressSink;
    /** Source path prefix for nested lists, e.g. `4.ifActions`. */
    pathPrefix?: string;
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
            itemRegistry: options?.itemRegistry,
            trust: options?.trust,
            onProgress: options?.onProgress,
        }));
    canonicalizeObservedActionItemNames(observed, options?.itemRegistry);
    if (options?.itemRegistry) {
        for (const action of desired) {
            canonicalizeActionItemName(action, options.itemRegistry);
        }
    }
    const diff = diffActionList(observed, desired);
    logSyncState(ctx, diff);
    await applyActionListDiff(
        ctx,
        observed,
        desired,
        diff,
        options?.itemRegistry,
        options?.onProgress,
        options?.pathPrefix
    );
    return { usedObserved: observed };
}
