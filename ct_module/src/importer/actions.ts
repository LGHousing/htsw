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
import { type ItemRegistry } from "../importables/itemRegistry";
import {
    VAR_HOLDER_OPTIONS,
    clickGoBack,
    waitForMenu,
    getSlotPaginate,
    openSubmenu,
    enterValue,
    setStringValue,
    setStringOrPaginatedOptionValue,
    setBooleanValue,
    setLocationValue,
    setSelectValue,
    setCycleValue,
    setNumberValue,
    readBooleanValue,
    readStringValue,
} from "./helpers";
import {
    readConditionList,
    syncConditionList,
} from "./conditions";
import {
    normalizeActionCompare,
    normalizeConditionCompare,
} from "./compare";
import {
    ACTION_MAPPINGS,
    getActionFieldLabel,
} from "./actionMappings";
import { diffActionList } from "./actions/diff";
import type {
    NestedPropsToRead,
    Observed,
} from "./types";
import { setItemValue } from "./items";
import type { ActionPath } from "./diffSink";
import { getActiveDiffSink } from "./diffSink";
import { resolveImportableItem } from "./resolveItem";
import { readActionList } from "./actions/readList";
import { syncActionList } from "./actions/sync";

// Public re-exports — external callers import these names from "./actions".
export { diffActionList };
export { readActionList, readActionsListPage } from "./actions/readList";
export { syncActionList } from "./actions/sync";
export { importAction } from "./actions/applyDiff";
export type {
    SyncActionListOptions,
    SyncActionListResult,
} from "./actions/sync";
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

// Ambient path tracker. `applyDiff.ts` wraps each edit/add in
// `withWritingActionPath`; the nested writers below
// (`writeConditional`, `writeRandom`) read `currentWritingActionPath`
// to compute pathPrefix for recursive `syncActionList` calls.
// Threading the path through every spec.write signature would change 35
// writers for two consumers — not worth it.
let currentWritingActionPath: ActionPath | null = null;

export function actionPathForIndex(pathPrefix: string | undefined, index: number): ActionPath {
    return pathPrefix && pathPrefix.length > 0
        ? `${pathPrefix}.${index}`
        : String(index);
}

export function withWritingActionPath<T>(path: ActionPath | null, fn: () => Promise<T>): Promise<T> {
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

/**
 * The action path the importer is currently writing into, or null when no
 * writer is active. Read by `readList.ts` to decide whether a `kind: "sync"`
 * read is the top-level import or a recursive nested sync inside a
 * CONDITIONAL/RANDOM writer (which would otherwise blow away the live
 * preview model with the inner list contents).
 */
export function getCurrentWritingActionPath(): ActionPath | null {
    return currentWritingActionPath;
}

type ActionSpecMap = {
    [K in Action["type"]]: ActionSpec<Extract<Action, { type: K }>>;
};

export function getActionSpec<T extends Action["type"]>(
    type: T
): ActionSpec<Extract<Action, { type: T }>> {
    return ACTION_SPECS[type] as ActionSpec<Extract<Action, { type: T }>>;
}

/**
 * Sub-step hooks for `readOpenConditional`. Optional. The visualization-
 * aware caller (top-level hydration in `readList.ts`) passes one in to
 * fire snapshot events and move the live-preview cursor between the
 * conditions / ifActions / elseActions menus. The standard caller
 * (recursive nested reads, exporter) leaves it undefined and the reader
 * runs straight through.
 */
export type ConditionalReadHooks = {
    /** Fired after the conditions list is read but before matchAny + the
     *  inner-action menus are touched. `conditions` is the freshly-read
     *  list. */
    onConditionsRead?(conditions: ReadonlyArray<Condition | null>): Promise<void>;
    /** Fired before opening the ifActions menu. */
    onIfActionsBefore?(): Promise<void>;
    /** Fired after ifActions are read. */
    onIfActionsRead?(ifActions: ReadonlyArray<Observed<Action> | null>): Promise<void>;
    /** Fired before opening the elseActions menu. */
    onElseActionsBefore?(): Promise<void>;
    /** Fired after elseActions are read. */
    onElseActionsRead?(elseActions: ReadonlyArray<Observed<Action> | null>): Promise<void>;
};

export async function readOpenConditional(
    ctx: TaskContext,
    propsToRead: NestedPropsToRead,
    itemRegistry?: ItemRegistry,
    hooks?: ConditionalReadHooks
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
        if (hooks?.onConditionsRead) await hooks.onConditionsRead(conditions);
    }

    const matchAny = readBooleanValue(ctx.getMenuItemSlot(matchAnyLabel)) ?? false;

    const ifActions: (Observed<Action> | null)[] = [];
    if (propsToRead.has("ifActions")) {
        if (hooks?.onIfActionsBefore) await hooks.onIfActionsBefore();
        ctx.getMenuItemSlot(ifActionsLabel).click();
        await waitForMenu(ctx);
        for (const entry of await readActionList(ctx, {
            kind: "full",
            itemRegistry,
        })) {
            ifActions.push(entry.action);
        }
        await clickGoBack(ctx);
        if (hooks?.onIfActionsRead) await hooks.onIfActionsRead(ifActions);
    }

    const elseActions: (Observed<Action> | null)[] = [];
    if (propsToRead.has("elseActions")) {
        if (hooks?.onElseActionsBefore) await hooks.onElseActionsBefore();
        ctx.getMenuItemSlot(elseActionsLabel).click();
        await waitForMenu(ctx);
        for (const entry of await readActionList(ctx, {
            kind: "full",
            itemRegistry,
        })) {
            elseActions.push(entry.action);
        }
        await clickGoBack(ctx);
        if (hooks?.onElseActionsRead) await hooks.onElseActionsRead(elseActions);
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

    // The conditional's head (conditions + matchAny) is now correct in
    // housing. Tell the live preview so the `if (...) {`, `} else {`,
    // and `}` lines flip to vibrant immediately — without this they'd
    // stay gray until every nested ifAction/elseAction op completes.
    if (currentWritingActionPath !== null) {
        getActiveDiffSink()?.markActionHeadApplied?.(currentWritingActionPath);
    }

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
        await resolveImportableItem(ctx, itemRegistry, action, action.itemName, "action")
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
            await resolveImportableItem(ctx, itemRegistry, action, action.itemName, "action")
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
    await setLocationValue(ctx, locationLabel, action.location);

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
        await setLocationValue(ctx, locationLabel, action.location);
    }
}

async function writeSetCompassTarget(
    ctx: TaskContext,
    action: ActionSetCompassTarget
): Promise<void> {
    const locationLabel = getActionFieldLabel("SET_COMPASS_TARGET", "location");
    await setLocationValue(ctx, locationLabel, action.location);
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
        await resolveImportableItem(ctx, itemRegistry, action, action.itemName, "action")
    );

    if (action.location !== undefined) {
        const locationLabel = getActionFieldLabel("DROP_ITEM", "location");
        await setLocationValue(ctx, locationLabel, action.location);
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
    await setLocationValue(ctx, locationLabel, action.location);
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

export async function writeOpenAction(
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
