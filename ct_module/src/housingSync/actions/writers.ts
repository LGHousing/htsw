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
} from "htsw/types";

import TaskContext from "../../tasks/context";
import {
    clickGoBack,
    findMenuOptionByLore,
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
    readStringValue,
} from "../menus/menuUtils";
import { timedWaitForMenu, waitForMenu } from "../menus/menuWait";
import {
    getActionFieldCycleOptions,
    getActionFieldDefault,
    getActionFieldLabel,
} from "../fields/actionMappings";
import { removedFormatting } from "../../utils/helpers";
import { normalizeSoundKey } from "../fields/sounds";
import { setItemValue } from "../items/itemPicker";
import type { WriteActionOptions } from "./io";

function booleanActionDefault(type: Action["type"], prop: string): boolean {
    return getActionFieldDefault(type, prop) as boolean;
}

function numberActionDefault(type: Action["type"], prop: string): number {
    return getActionFieldDefault(type, prop) as number;
}

function stringActionDefault(type: Action["type"], prop: string): string {
    return getActionFieldDefault(type, prop) as string;
}

async function setPlayerTimeValue(ctx: TaskContext, value: number): Promise<void> {
    const slotName = getActionFieldLabel("SET_PLAYER_TIME", "time");
    const current = readStringValue(ctx.getMenuItemSlot(slotName));
    const time = value.toString();
    if (current === time) return;

    await openSubmenu(ctx, slotName);
    const customSlot = await getSlotPaginate(ctx, "Custom Time");
    customSlot.click();
    await enterValue(ctx, time);
    await waitForMenu(ctx);
}

export async function writeConditional(
    ctx: TaskContext,
    action: ActionConditional,
    options: WriteActionOptions<ActionConditional>
): Promise<void> {
    const current = options.current;

    if (
        options.apply.shouldApplyList("conditions") &&
        (action.conditions.length > 0 || (current?.conditions?.length ?? 0) > 0)
    ) {
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "conditions")).click();
        await waitForMenu(ctx);

        await options.apply.applyConditions("conditions", {
            desired: action.conditions,
            observed: current?.conditions,
        });
        await clickGoBack(ctx);
    }

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "matchAny")),
        action.matchAny
    );

    options.apply.markHeaderApplied();

    if (
        options.apply.shouldApplyList("ifActions") &&
        (action.ifActions.length > 0 || (current?.ifActions?.length ?? 0) > 0)
    ) {
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "ifActions")).click();
        await waitForMenu(ctx);
        await options.apply.applyChildActions("ifActions", {
            desired: action.ifActions,
            observed: current?.ifActions,
        });
        await clickGoBack(ctx);
    }

    if (
        options.apply.shouldApplyList("elseActions") &&
        (action.elseActions.length > 0 || (current?.elseActions?.length ?? 0) > 0)
    ) {
        ctx.getMenuItemSlot(getActionFieldLabel("CONDITIONAL", "elseActions")).click();
        await waitForMenu(ctx);
        await options.apply.applyChildActions("elseActions", {
            desired: action.elseActions,
            observed: current?.elseActions,
        });
        await clickGoBack(ctx);
    }
}

export async function writeSetGroup(
    ctx: TaskContext,
    action: ActionSetGroup
): Promise<void> {
    await setSelectValue(ctx, getActionFieldLabel("SET_GROUP", "group"), action.group);

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("SET_GROUP", "demotionProtection")),
        action.demotionProtection ??
            booleanActionDefault("SET_GROUP", "demotionProtection")
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
        action.subtitle ?? stringActionDefault("TITLE", "subtitle")
    );

    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "fadein")),
        action.fadein ?? numberActionDefault("TITLE", "fadein")
    );

    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "stay")),
        action.stay ?? numberActionDefault("TITLE", "stay")
    );

    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("TITLE", "fadeout")),
        action.fadeout ?? numberActionDefault("TITLE", "fadeout")
    );
}

export async function writeActionBar(
    ctx: TaskContext,
    action: ActionActionBar
): Promise<void> {
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
    options: WriteActionOptions<ActionGiveItem>
): Promise<void> {
    await setItemValue(
        ctx,
        getActionFieldLabel("GIVE_ITEM", "itemName"),
        await options.resolveItem(action, action.itemName, "action")
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("GIVE_ITEM", "allowMultiple")),
        action.allowMultiple ?? booleanActionDefault("GIVE_ITEM", "allowMultiple")
    );

    const slotLabel = getActionFieldLabel("GIVE_ITEM", "slot");
    const slotValue = String(action.slot ?? stringActionDefault("GIVE_ITEM", "slot"));
    if (/^\d+$/.test(slotValue) || slotValue.indexOf("%") >= 0) {
        await openSubmenu(ctx, slotLabel);
        const manualSlot = await getSlotPaginate(ctx, "Manual Input");
        manualSlot.click();
        await enterValue(ctx, slotValue);
        await waitForMenu(ctx);
    } else {
        await setSelectValue(ctx, slotLabel, slotValue);
    }

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("GIVE_ITEM", "replaceExisting")),
        action.replaceExisting ?? booleanActionDefault("GIVE_ITEM", "replaceExisting")
    );
}

export async function writeRemoveItem(
    ctx: TaskContext,
    action: ActionRemoveItem,
    options: WriteActionOptions<ActionRemoveItem>
): Promise<void> {
    if (action.itemName !== undefined) {
        await setItemValue(
            ctx,
            getActionFieldLabel("REMOVE_ITEM", "itemName"),
            await options.resolveItem(action, action.itemName, "action")
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
        action.level ?? numberActionDefault("APPLY_POTION_EFFECT", "level")
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("APPLY_POTION_EFFECT", "override")),
        action.override ?? booleanActionDefault("APPLY_POTION_EFFECT", "override")
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("APPLY_POTION_EFFECT", "showIcon")),
        action.showIcon ?? booleanActionDefault("APPLY_POTION_EFFECT", "showIcon")
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

const ADVANCED_VAR_OPERATIONS = [
    "Bitwise AND",
    "Bitwise OR",
    "Bitwise XOR",
    "Left Shift",
    "Arithmetic Right Shift",
    "Logical Right Shift",
] as const;

function isAdvancedVarOperation(value: string): boolean {
    return (ADVANCED_VAR_OPERATIONS as readonly string[]).indexOf(value) !== -1;
}

function isAlreadySelectedOptionSlot(slot: {
    getItem(): { getLore(): string[] };
}): boolean {
    return slot
        .getItem()
        .getLore()
        .some((line) =>
            removedFormatting(line).trim().toLowerCase().includes("already selected")
        );
}

async function selectOpenOption(
    ctx: TaskContext,
    fieldLabel: string,
    value: string
): Promise<void> {
    const optionSlot = await getSlotPaginate(ctx, value);
    if (isAlreadySelectedOptionSlot(optionSlot)) {
        await clickGoBack(ctx);
        return;
    }

    optionSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");

    if (ctx.tryGetMenuItemSlot(fieldLabel) !== null) return;
    await clickGoBack(ctx);
}

async function setChangeVarOperation(ctx: TaskContext, operation: string): Promise<void> {
    const operationLabel = getActionFieldLabel("CHANGE_VAR", "op");
    const currentSlot = ctx.tryGetMenuItemSlot(operationLabel);
    if (currentSlot !== null) {
        const currentValue = readStringValue(currentSlot);
        if (currentValue !== null && currentValue === operation) return;
    }

    await openSubmenu(ctx, operationLabel);

    try {
        await selectOpenOption(ctx, operationLabel, operation);
        return;
    } catch (error) {
        if (!isAdvancedVarOperation(operation)) throw error;

        const toggleSlot = ctx.tryGetMenuItemSlot("Toggle Advanced Operations");
        if (toggleSlot === null) throw error;

        toggleSlot.click();
        await timedWaitForMenu(ctx, "menuClickWait");
    }

    await selectOpenOption(ctx, operationLabel, operation);
}

export async function writeChangeVar(
    ctx: TaskContext,
    action: ActionChangeVar
): Promise<void> {
    await setCycleValue(
        ctx,
        getActionFieldLabel("CHANGE_VAR", "holder"),
        getActionFieldCycleOptions("CHANGE_VAR", "holder"),
        action.holder.type
    );
    if (action.holder.type === "Team" && action.holder.team !== undefined) {
        await setSelectValue(ctx, "Team", action.holder.team);
    }

    if (action.key) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getActionFieldLabel("CHANGE_VAR", "key")),
            action.key
        );
    }

    await setChangeVarOperation(ctx, action.op);
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
        action.unset ?? booleanActionDefault("CHANGE_VAR", "unset")
    );
}

export async function writeTeleport(
    ctx: TaskContext,
    action: ActionTeleport
): Promise<void> {
    const locationLabel = getActionFieldLabel("TELEPORT", "location");
    await setLocationValue(ctx, locationLabel, action.location);

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(
            getActionFieldLabel("TELEPORT", "preventTeleportInsideBlocks")
        ),
        action.preventTeleportInsideBlocks ??
            booleanActionDefault("TELEPORT", "preventTeleportInsideBlocks")
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
    const editorSound = normalizeSoundKey(
        readStringValue(ctx.getMenuItemSlot(soundLabel))
    );
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
        action.volume ?? numberActionDefault("PLAY_SOUND", "volume")
    );

    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("PLAY_SOUND", "pitch")),
        action.pitch ?? numberActionDefault("PLAY_SOUND", "pitch")
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
    options: WriteActionOptions<ActionRandom>
): Promise<void> {
    const current = options.current;
    if (!options.apply.shouldApplyList("actions")) {
        return;
    }
    if (action.actions.length === 0 && (current?.actions?.length ?? 0) === 0) return;

    options.apply.markHeaderApplied();

    ctx.getMenuItemSlot(getActionFieldLabel("RANDOM", "actions")).click();
    await waitForMenu(ctx);
    await options.apply.applyChildActions("actions", {
        desired: action.actions,
        observed: current?.actions,
    });
    await clickGoBack(ctx);
}

export async function writeFunction(
    ctx: TaskContext,
    action: ActionFunction
): Promise<void> {
    await setStringOrPaginatedOptionValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("FUNCTION", "function")),
        action.function
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("FUNCTION", "global")),
        action.global ?? booleanActionDefault("FUNCTION", "global")
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

export async function writePause(
    ctx: TaskContext,
    action: ActionPauseExecution
): Promise<void> {
    await setNumberValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("PAUSE", "ticks")),
        action.ticks
    );
}

export async function writeSetTeam(
    ctx: TaskContext,
    action: ActionSetTeam
): Promise<void> {
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
    options: WriteActionOptions<ActionDropItem>
): Promise<void> {
    await setItemValue(
        ctx,
        getActionFieldLabel("DROP_ITEM", "itemName"),
        await options.resolveItem(action, action.itemName, "action")
    );

    const locationLabel = getActionFieldLabel("DROP_ITEM", "location");
    await setLocationValue(ctx, locationLabel, action.location);

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "dropNaturally")),
        action.dropNaturally ?? booleanActionDefault("DROP_ITEM", "dropNaturally")
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "disableMerging")),
        action.disableMerging ?? booleanActionDefault("DROP_ITEM", "disableMerging")
    );

    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "despawnDurationTicks")),
        String(
            action.despawnDurationTicks ??
                numberActionDefault("DROP_ITEM", "despawnDurationTicks")
        )
    );

    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "pickupDelayTicks")),
        String(
            action.pickupDelayTicks ??
                numberActionDefault("DROP_ITEM", "pickupDelayTicks")
        )
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "prioritizePlayer")),
        action.prioritizePlayer ?? booleanActionDefault("DROP_ITEM", "prioritizePlayer")
    );

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getActionFieldLabel("DROP_ITEM", "inventoryFallback")),
        action.inventoryFallback ?? booleanActionDefault("DROP_ITEM", "inventoryFallback")
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
    await setCycleValue(
        ctx,
        getActionFieldLabel("SET_PLAYER_WEATHER", "weather"),
        ["None", "Sunny", "Raining"],
        action.weather
    );
}

export async function writeSetPlayerTime(
    ctx: TaskContext,
    action: ActionSetPlayerTime
): Promise<void> {
    await setPlayerTimeValue(ctx, action.time);
}

export async function writeToggleNametagDisplay(
    ctx: TaskContext,
    action: ActionToggleNametagDisplay
): Promise<void> {
    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(
            getActionFieldLabel("TOGGLE_NAMETAG_DISPLAY", "displayNametag")
        ),
        action.displayNametag
    );
}
