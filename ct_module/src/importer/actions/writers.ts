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

import TaskContext from "../../tasks/context";
import {
    clickGoBack,
    findMenuOptionByLore,
    openSubmenu,
    enterValue,
    setStringValue,
    setStringOrPaginatedOptionValue,
    setBooleanValue,
    setLocationValue,
    setSelectValue,
    setCycleValue,
    setNumberValue,
    readStringValue,
} from "../gui/helpers";
import { waitForMenu } from "../gui/menuWait";
import { syncConditionList } from "../conditions/sync";
import {
    normalizeActionCompare,
    normalizeConditionCompare,
} from "../fields/compare";
import {
    getActionFieldCycleOptions,
    getActionFieldDefault,
    getActionFieldLabel,
} from "../fields/actionMappings";
import { normalizeSoundKey } from "../fields/sounds";
import type { Observed } from "../types";
import { setItemValue } from "../items/items";
import { resolveImportableItem } from "../items/resolveItem";
import { syncActionList } from "./sync";
import type { WriteActionOptions } from "./specs";

function actionDefault<T>(type: Action["type"], prop: string): T {
    return getActionFieldDefault(type, prop) as T;
}

function observedActionsAsBaselineCurrent(
    observed: ReadonlyArray<Observed<Action> | null> | undefined
): readonly Action[] | undefined {
    if (observed === undefined) return undefined;
    const out: Action[] = [];
    for (const entry of observed) {
        if (entry !== null) out.push(entry as Action);
    }
    return out;
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

export async function writeConditional(
    ctx: TaskContext,
    action: ActionConditional,
    options?: WriteActionOptions<ActionConditional>
): Promise<void> {
    const current = options?.current;
    const itemRegistry = options?.itemRegistry;
    const pathPrefix = options?.pathPrefix;
    if (
        !conditionListsEqual(current?.conditions, action.conditions) &&
        (action.conditions.length > 0 || (current?.conditions?.length ?? 0) > 0)
    ) {
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "conditions")).click();
        await waitForMenu(ctx);

        await syncConditionList(ctx, action.conditions, {
            itemRegistry,
            baselineCurrent: current?.conditions,
        });
        await clickGoBack(ctx);
    }

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "matchAny")),
        action.matchAny
    );

    if (pathPrefix !== undefined) {
        options?.events?.emit({
            kind: "blockActionHeaderApplied",
            path: pathPrefix,
        });
    }

    if (
        !observedActionListsEqual(current?.ifActions, action.ifActions) &&
        (action.ifActions.length > 0 || (current?.ifActions?.length ?? 0) > 0)
    ) {
        const nestedPath = pathPrefix === undefined ? "ifActions" : `${pathPrefix}.ifActions`;
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "ifActions")).click();
        await waitForMenu(ctx);
        await syncActionList(ctx, action.ifActions, {
            itemRegistry,
            pathPrefix: nestedPath,
            baselineCurrent: observedActionsAsBaselineCurrent(current?.ifActions),
            progressScope: options?.nestedProgressScope?.(nestedPath),
            events: options?.events,
        });
        await clickGoBack(ctx);
    }

    if (
        !observedActionListsEqual(current?.elseActions, action.elseActions) &&
        (action.elseActions.length > 0 || (current?.elseActions?.length ?? 0) > 0)
    ) {
        const nestedPath = pathPrefix === undefined ? "elseActions" : `${pathPrefix}.elseActions`;
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "elseActions")).click();
        await waitForMenu(ctx);
        await syncActionList(ctx, action.elseActions, {
            itemRegistry,
            pathPrefix: nestedPath,
            baselineCurrent: observedActionsAsBaselineCurrent(current?.elseActions),
            progressScope: options?.nestedProgressScope?.(nestedPath),
            events: options?.events,
        });
        await clickGoBack(ctx);
    }
}

export async function writeSetGroup(ctx: TaskContext, action: ActionSetGroup): Promise<void> {
    await setSelectValue(ctx, getActionFieldLabel("SET_GROUP", "group"), action.group);

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("SET_GROUP", "demotionProtection")),
        action.demotionProtection ?? actionDefault<boolean>("SET_GROUP", "demotionProtection")
    );
}

export async function writeTitle(ctx: TaskContext, action: ActionTitle): Promise<void> {
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "title")),
        action.title
    );

    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "subtitle")),
        action.subtitle ?? actionDefault<string>("TITLE", "subtitle")
    );

    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "fadein")),
        action.fadein ?? actionDefault<number>("TITLE", "fadein")
    );

    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "stay")),
        action.stay ?? actionDefault<number>("TITLE", "stay")
    );

    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "fadeout")),
        action.fadeout ?? actionDefault<number>("TITLE", "fadeout")
    );
}

export async function writeActionBar(ctx: TaskContext, action: ActionActionBar): Promise<void> {
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("ACTION_BAR", "message")),
        action.message
    );
}

export async function writeChangeMaxHealth(
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

export async function writeGiveItem(
    ctx: TaskContext,
    action: ActionGiveItem,
    options?: WriteActionOptions<ActionGiveItem>
): Promise<void> {
    const itemRegistry = options?.itemRegistry;
    await setItemValue(
        ctx,
        getActionFieldLabel("GIVE_ITEM", "itemName"),
        await resolveImportableItem(ctx, itemRegistry, action, action.itemName, "action")
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("GIVE_ITEM", "allowMultiple")),
        action.allowMultiple ?? actionDefault<boolean>("GIVE_ITEM", "allowMultiple")
    );

    await setSelectValue(
        ctx,
        getActionFieldLabel("GIVE_ITEM", "slot"),
        String(action.slot ?? actionDefault<string>("GIVE_ITEM", "slot"))
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("GIVE_ITEM", "replaceExisting")),
        action.replaceExisting ?? actionDefault<boolean>("GIVE_ITEM", "replaceExisting")
    );
}

export async function writeRemoveItem(
    ctx: TaskContext,
    action: ActionRemoveItem,
    options?: WriteActionOptions<ActionRemoveItem>
): Promise<void> {
    const itemRegistry = options?.itemRegistry;
    if (action.itemName !== undefined) {
        await setItemValue(
            ctx,
            getActionFieldLabel("REMOVE_ITEM", "itemName"),
            await resolveImportableItem(ctx, itemRegistry, action, action.itemName, "action")
        );
    }
}

export async function writeSendMessage(
    ctx: TaskContext,
    action: ActionSendMessage
): Promise<void> {
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("MESSAGE", "message")),
        action.message
    );
}

export async function writeApplyPotionEffect(
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

    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("APPLY_POTION_EFFECT", "level")),
        action.level ?? actionDefault<number>("APPLY_POTION_EFFECT", "level")
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("APPLY_POTION_EFFECT", "override")),
        action.override ?? actionDefault<boolean>("APPLY_POTION_EFFECT", "override")
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("APPLY_POTION_EFFECT", "showIcon")),
        action.showIcon ?? actionDefault<boolean>("APPLY_POTION_EFFECT", "showIcon")
    );
}

export async function writeGiveExperienceLevels(
    ctx: TaskContext,
    action: ActionGiveExperienceLevels
): Promise<void> {
    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("GIVE_EXPERIENCE_LEVELS", "amount")),
        action.amount
    );
}

export async function writeSendToLobby(
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

export async function writeChangeVar(ctx: TaskContext, action: ActionChangeVar): Promise<void> {
    if (action.holder) {
        await setCycleValue(
            ctx,
            getActionFieldLabel("CHANGE_VAR", "holder"),
            getActionFieldCycleOptions("CHANGE_VAR", "holder"),
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
    if (action.op === "Unset") return;

    if (action.value) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("CHANGE_VAR", "value")),
            action.value
        );
    }

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("CHANGE_VAR", "unset")),
        action.unset ?? actionDefault<boolean>("CHANGE_VAR", "unset")
    );
}

export async function writeTeleport(ctx: TaskContext, action: ActionTeleport): Promise<void> {
    const locationLabel = getActionFieldLabel("TELEPORT", "location");
    await setLocationValue(ctx, locationLabel, action.location);

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(
            getActionFieldLabel("TELEPORT", "preventTeleportInsideBlocks")
        ),
        action.preventTeleportInsideBlocks ??
            actionDefault<boolean>("TELEPORT", "preventTeleportInsideBlocks")
    );
}

export async function writeFailParkour(
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

export async function writePlaySound(
    ctx: TaskContext,
    action: ActionPlaySound
): Promise<void> {
    const soundLabel = getActionFieldLabel("PLAY_SOUND", "sound");
    const desiredSound = normalizeSoundKey(action.sound) ?? action.sound;
    const editorSound = normalizeSoundKey(readStringValue(ctx.getMenuItemSlot(soundLabel)));
    if (editorSound !== desiredSound) {
        await openSubmenu(ctx, soundLabel);
        const customSoundSlot = findMenuOptionByLore(ctx, "Click to edit!");
        if (customSoundSlot === null) {
            throw new Error("Could not find custom sound editor slot");
        }
        customSoundSlot.click();
        await enterValue(ctx, desiredSound);
        await waitForMenu(ctx);
    }

    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("PLAY_SOUND", "volume")),
        action.volume ?? actionDefault<number>("PLAY_SOUND", "volume")
    );

    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("PLAY_SOUND", "pitch")),
        action.pitch ?? actionDefault<number>("PLAY_SOUND", "pitch")
    );

    if (action.location !== undefined) {
        const locationLabel = getActionFieldLabel("PLAY_SOUND", "location");
        await setLocationValue(ctx, locationLabel, action.location);
    }
}

export async function writeSetCompassTarget(
    ctx: TaskContext,
    action: ActionSetCompassTarget
): Promise<void> {
    const locationLabel = getActionFieldLabel("SET_COMPASS_TARGET", "location");
    await setLocationValue(ctx, locationLabel, action.location);
}

export async function writeSetGamemode(
    ctx: TaskContext,
    action: ActionSetGamemode
): Promise<void> {
    await setCycleValue(
        ctx,
        getActionFieldLabel("SET_GAMEMODE", "gamemode"),
        getActionFieldCycleOptions("SET_GAMEMODE", "gamemode"),
        action.gamemode
    );
}

export async function writeChangeHealth(
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

export async function writeChangeHunger(
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

export async function writeRandom(
    ctx: TaskContext,
    action: ActionRandom,
    options?: WriteActionOptions<ActionRandom>
): Promise<void> {
    const current = options?.current;
    const itemRegistry = options?.itemRegistry;
    const pathPrefix = options?.pathPrefix;
    if (observedActionListsEqual(current?.actions, action.actions)) return;
    if (action.actions.length === 0 && (current?.actions?.length ?? 0) === 0) return;

    if (pathPrefix !== undefined) {
        options?.events?.emit({
            kind: "blockActionHeaderApplied",
            path: pathPrefix,
        });
    }

    ctx.getMenuItemSlot(getActionFieldLabel("RANDOM", "actions")).click();
    await waitForMenu(ctx);
    const nestedPath = pathPrefix === undefined ? "actions" : `${pathPrefix}.actions`;
    await syncActionList(ctx, action.actions, {
        itemRegistry,
        pathPrefix: nestedPath,
        baselineCurrent: observedActionsAsBaselineCurrent(current?.actions),
        progressScope: options?.nestedProgressScope?.(nestedPath),
        events: options?.events,
    });
    await clickGoBack(ctx);
}

export async function writeFunction(ctx: TaskContext, action: ActionFunction): Promise<void> {
    await setStringOrPaginatedOptionValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("FUNCTION", "function")),
        action.function
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("FUNCTION", "global")),
        action.global ?? actionDefault<boolean>("FUNCTION", "global")
    );
}

export async function writeApplyInventoryLayout(
    ctx: TaskContext,
    action: ActionApplyInventoryLayout
): Promise<void> {
    await setSelectValue(
        ctx,
        getActionFieldLabel("APPLY_INVENTORY_LAYOUT", "layout"),
        action.layout
    );
}

export async function writeEnchantHeldItem(
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

export async function writePause(ctx: TaskContext, action: ActionPauseExecution): Promise<void> {
    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("PAUSE", "ticks")),
        action.ticks
    );
}

export async function writeSetTeam(ctx: TaskContext, action: ActionSetTeam): Promise<void> {
    await setSelectValue(ctx, getActionFieldLabel("SET_TEAM", "team"), action.team);
}

export async function writeDisplayMenu(
    ctx: TaskContext,
    action: ActionDisplayMenu
): Promise<void> {
    await setSelectValue(ctx, getActionFieldLabel("SET_MENU", "menu"), action.menu);
}

export async function writeDropItem(
    ctx: TaskContext,
    action: ActionDropItem,
    options?: WriteActionOptions<ActionDropItem>
): Promise<void> {
    const itemRegistry = options?.itemRegistry;
    await setItemValue(
        ctx,
        getActionFieldLabel("DROP_ITEM", "itemName"),
        await resolveImportableItem(ctx, itemRegistry, action, action.itemName, "action")
    );

    if (action.location !== undefined) {
        const locationLabel = getActionFieldLabel("DROP_ITEM", "location");
        await setLocationValue(ctx, locationLabel, action.location);
    }

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "dropNaturally")),
        action.dropNaturally ?? actionDefault<boolean>("DROP_ITEM", "dropNaturally")
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "disableMerging")),
        action.disableMerging ?? actionDefault<boolean>("DROP_ITEM", "disableMerging")
    );

    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "despawnDurationTicks")),
        String(action.despawnDurationTicks ?? actionDefault<number>("DROP_ITEM", "despawnDurationTicks"))
    );

    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "pickupDelayTicks")),
        String(action.pickupDelayTicks ?? actionDefault<number>("DROP_ITEM", "pickupDelayTicks"))
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "prioritizePlayer")),
        action.prioritizePlayer ?? actionDefault<boolean>("DROP_ITEM", "prioritizePlayer")
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "inventoryFallback")),
        action.inventoryFallback ?? actionDefault<boolean>("DROP_ITEM", "inventoryFallback")
    );
}

export async function writeSetVelocity(
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

export async function writeLaunch(ctx: TaskContext, action: ActionLaunch): Promise<void> {
    const locationLabel = getActionFieldLabel("LAUNCH", "location");
    await setLocationValue(ctx, locationLabel, action.location);
    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("LAUNCH", "strength")),
        action.strength
    );
}

export async function writeSetPlayerWeather(
    ctx: TaskContext,
    action: ActionSetPlayerWeather
): Promise<void> {
    await setSelectValue(
        ctx,
        getActionFieldLabel("SET_PLAYER_WEATHER", "weather"),
        action.weather
    );
}

export async function writeSetPlayerTime(
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

export async function writeToggleNametagDisplay(
    ctx: TaskContext,
    action: ActionToggleNametagDisplay
): Promise<void> {
    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("TOGGLE_NAMETAG_DISPLAY", "displayNametag")),
        action.displayNametag
    );
}
