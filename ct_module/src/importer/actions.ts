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
    ActionSetVelocity,
    ActionSendToLobby,
    ActionTeleport,
    ActionTitle,
    ActionEnchantHeldItem,
    ActionDisplayMenu,
} from "htsw/types";

import TaskContext from "../tasks/context";
import {
    clickSlotPaginate,
    clickSlot,
    goBack,
    waitForMenuToLoad,
    setValue,
} from "./helpers";

const ACTION_DISPLAY_NAMES: Record<Action["type"], string> = {
    CHANGE_VAR: "Change Variable",
    CONDITIONAL: "Conditional",
    MESSAGE: "Send a Chat Message",
    PLAY_SOUND: "Play Sound",
    GIVE_ITEM: "Give Item",
    TITLE: "Display Title",
    EXIT: "Exit",
    SET_GROUP: "Change Player's Group",
    KILL: "Kill Player",
    HEAL: "Full Heal",
    ACTION_BAR: "Display Action Bar",
    RESET_INVENTORY: "Reset Inventory",
    REMOVE_ITEM: "Remove Item",
    APPLY_POTION_EFFECT: "Apply Potion Effect",
    SET_MENU: "Display Menu",
    SET_TEAM: "Set Player Team",
    PAUSE: "Pause Execution",
    ENCHANT_HELD_ITEM: "Enchant Held Item",
    APPLY_INVENTORY_LAYOUT: "Apply Inventory Layout",
    FUNCTION: "Trigger Function",
    RANDOM: "Random Action",
    SET_GAMEMODE: "Set Gamemode",
    SET_COMPASS_TARGET: "Set Compass Target",
    FAIL_PARKOUR: "Fail Parkour",
    TELEPORT: "Teleport Player",
    SEND_TO_LOBBY: "Send to Lobby",
    GIVE_EXPERIENCE_LEVELS: "Give Experience Levels",
    CLEAR_POTION_EFFECTS: "Clear All Potion Effects",
    CHANGE_MAX_HEALTH: "Change Max Health",
    CHANGE_HEALTH: "Change Health",
    CHANGE_HUNGER: "Change Hunger Level",
    DROP_ITEM: "Drop Item",
    SET_VELOCITY: "Change Velocity",
    LAUNCH: "Launch to Target",
    CANCEL_EVENT: "Cancel Event",
};

export async function importAction(ctx: TaskContext, action: Action): Promise<void> {
    await clickSlot(ctx, "Add Action");
    await clickSlotPaginate(ctx, ACTION_DISPLAY_NAMES[action.type]);

    switch (action.type) {
        case "CHANGE_VAR":
            return await importChangeVar(ctx, action);
        case "CONDITIONAL":
            return await importConditional(ctx, action);
        case "MESSAGE":
            return await importSendMessage(ctx, action);
        case "PLAY_SOUND":
            return await importPlaySound(ctx, action);
        case "GIVE_ITEM":
            return await importGiveItem(ctx, action);
        case "TITLE":
            return await importTitle(ctx, action);
        case "EXIT":
            return;
        case "SET_GROUP":
            return await importSetGroup(ctx, action);
        case "KILL":
            return;
        case "HEAL":
            return;
        case "ACTION_BAR":
            return await importActionBar(ctx, action);
        case "RESET_INVENTORY":
            return;
        case "REMOVE_ITEM":
            return await importRemoveItem(ctx, action);
        case "APPLY_POTION_EFFECT":
            return await importApplyPotionEffect(ctx, action);
        case "SET_MENU":
            return await importDisplayMenu(ctx, action);
        case "SET_TEAM":
            return await importSetTeam(ctx, action);
        case "PAUSE":
            return await importPause(ctx, action);
        case "ENCHANT_HELD_ITEM":
            return await importEnchantHeldItem(ctx, action);
        case "APPLY_INVENTORY_LAYOUT":
            return await importApplyInventoryLayout(ctx, action);
        case "FUNCTION":
            return await importFunction(ctx, action);
        case "RANDOM":
            return await importRandom(ctx, action);
        case "SET_GAMEMODE":
            return await importSetGamemode(ctx, action);
        case "SET_COMPASS_TARGET":
            return await importSetCompassTarget(ctx, action);
        case "FAIL_PARKOUR":
            return await importFailParkour(ctx, action);
        case "TELEPORT":
            return await importTeleport(ctx, action);
        case "SEND_TO_LOBBY":
            return await importSendToLobby(ctx, action);
        case "GIVE_EXPERIENCE_LEVELS":
            return await importGiveExperienceLevels(ctx, action);
        case "CLEAR_POTION_EFFECTS":
            return;
        case "CHANGE_MAX_HEALTH":
            return await importChangeMaxHealth(ctx, action);
        case "CHANGE_HEALTH":
            return await importChangeHealth(ctx, action);
        case "CHANGE_HUNGER":
            return await importChangeHunger(ctx, action);
        case "DROP_ITEM":
            return await importDropItem(ctx, action);
        case "SET_VELOCITY":
            return await importSetVelocity(ctx, action);
        case "LAUNCH":
            return await importLaunch(ctx, action);
        case "CANCEL_EVENT":
            return;
        default:
            const _exhaustiveCheck: never = action;
    }
}

async function importChangeVar(
    ctx: TaskContext,
    action: ActionChangeVar
): Promise<void> {}

async function importConditional(
    ctx: TaskContext,
    action: ActionConditional
): Promise<void> {}

async function importSendMessage(
    ctx: TaskContext,
    action: ActionSendMessage
): Promise<void> {
    await setValue(ctx, "Message", action.message);
    await goBack(ctx);
}

async function importActionBar(
    ctx: TaskContext,
    action: ActionActionBar
): Promise<void> {}

async function importPlaySound(
    ctx: TaskContext,
    action: ActionPlaySound
): Promise<void> {}

async function importGiveItem(ctx: TaskContext, action: ActionGiveItem): Promise<void> {}

async function importTitle(ctx: TaskContext, action: ActionTitle): Promise<void> {}

async function importSetGroup(ctx: TaskContext, action: ActionSetGroup): Promise<void> {}

async function importRemoveItem(
    ctx: TaskContext,
    action: ActionRemoveItem
): Promise<void> {}

async function importApplyPotionEffect(
    ctx: TaskContext,
    action: ActionApplyPotionEffect
): Promise<void> {}

async function importDisplayMenu(
    ctx: TaskContext,
    action: ActionDisplayMenu
): Promise<void> {}

async function importSetTeam(ctx: TaskContext, action: ActionSetTeam): Promise<void> {}

async function importPause(
    ctx: TaskContext,
    action: ActionPauseExecution
): Promise<void> {}

async function importEnchantHeldItem(
    ctx: TaskContext,
    action: ActionEnchantHeldItem
): Promise<void> {}

async function importApplyInventoryLayout(
    ctx: TaskContext,
    action: ActionApplyInventoryLayout
): Promise<void> {}

async function importFunction(ctx: TaskContext, action: ActionFunction): Promise<void> {}

async function importRandom(ctx: TaskContext, action: ActionRandom): Promise<void> {}

async function importSetGamemode(
    ctx: TaskContext,
    action: ActionSetGamemode
): Promise<void> {}

async function importSetCompassTarget(
    ctx: TaskContext,
    action: ActionSetCompassTarget
): Promise<void> {}

async function importFailParkour(
    ctx: TaskContext,
    action: ActionFailParkour
): Promise<void> {}

async function importTeleport(ctx: TaskContext, action: ActionTeleport): Promise<void> {}

async function importSendToLobby(
    ctx: TaskContext,
    action: ActionSendToLobby
): Promise<void> {}

async function importGiveExperienceLevels(
    ctx: TaskContext,
    action: ActionGiveExperienceLevels
): Promise<void> {}

async function importChangeMaxHealth(
    ctx: TaskContext,
    action: ActionChangeMaxHealth
): Promise<void> {}

async function importChangeHealth(
    ctx: TaskContext,
    action: ActionChangeHealth
): Promise<void> {}

async function importChangeHunger(
    ctx: TaskContext,
    action: ActionChangeHunger
): Promise<void> {}

async function importDropItem(ctx: TaskContext, action: ActionDropItem): Promise<void> {}

async function importSetVelocity(
    ctx: TaskContext,
    action: ActionSetVelocity
): Promise<void> {}

async function importLaunch(ctx: TaskContext, action: ActionLaunch): Promise<void> {}

async function importLocation(
    ctx: TaskContext,
    slot: number,
    location: { type: string; value?: string }
): Promise<void> {}

async function importInventorySlot(
    ctx: TaskContext,
    slot: number,
    value: number | string
): Promise<void> {}
