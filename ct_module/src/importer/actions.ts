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
    findItemSlotPaginate,
} from "./helpers";
import { ItemSlot } from "../tasks/specifics/slots";
import { removedFormatting } from "../helpers";
import { Diagnostic } from "htsw";

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

function isLimitExceeded(slot: ItemSlot): boolean {
    const lore = slot.getItem().getLore();
    if (lore.length === 0) return false;
    const lastLine = lore[lore.length - 1];
    console.log(removedFormatting(lastLine));
    return removedFormatting(lastLine) === "You can't have more of this action!";
}

export async function importAction(
    ctx: TaskContext,
    action: Action,
): Promise<void> {
    clickSlot(ctx, "Add Action");
    await waitForMenuToLoad(ctx);

    const displayName = ACTION_DISPLAY_NAMES[action.type];

    const slot = await findItemSlotPaginate(ctx, displayName);

    if (isLimitExceeded(slot)) {
        throw Diagnostic.error(`Maximum amount of ${displayName} actions exceeded`);
    }

    slot.click();
    await waitForMenuToLoad(ctx);

    if (action.type === "CHANGE_VAR") {
        await importChangeVar(ctx, action);
    } else if (action.type === "CONDITIONAL") {
        await importConditional(ctx, action);
    } else if (action.type === "MESSAGE") {
        await importSendMessage(ctx, action);
    } else if (action.type === "PLAY_SOUND") {
        await importPlaySound(ctx, action);
    } else if (action.type === "GIVE_ITEM") {
        await importGiveItem(ctx, action);
    } else if (action.type === "TITLE") {
        await importTitle(ctx, action);
    } else if (action.type === "EXIT") {
        return;
    } else if (action.type === "SET_GROUP") {
        await importSetGroup(ctx, action);
    } else if (action.type === "KILL") {
        return;
    } else if (action.type === "HEAL") {
        return;
    } else if (action.type === "ACTION_BAR") {
        await importActionBar(ctx, action);
    } else if (action.type === "RESET_INVENTORY") {
        return;
    } else if (action.type === "REMOVE_ITEM") {
        await importRemoveItem(ctx, action);
    } else if (action.type === "APPLY_POTION_EFFECT") {
        await importApplyPotionEffect(ctx, action);
    } else if (action.type === "SET_MENU") {
        await importDisplayMenu(ctx, action);
    } else if (action.type === "SET_TEAM") {
        await importSetTeam(ctx, action);
    } else if (action.type === "PAUSE") {
        await importPause(ctx, action);
    } else if (action.type === "ENCHANT_HELD_ITEM") {
        await importEnchantHeldItem(ctx, action);
    } else if (action.type === "APPLY_INVENTORY_LAYOUT") {
        await importApplyInventoryLayout(ctx, action);
    } else if (action.type === "FUNCTION") {
        await importFunction(ctx, action);
    } else if (action.type === "RANDOM") {
        await importRandom(ctx, action);
    } else if (action.type === "SET_GAMEMODE") {
        await importSetGamemode(ctx, action);
    } else if (action.type === "SET_COMPASS_TARGET") {
        await importSetCompassTarget(ctx, action);
    } else if (action.type === "FAIL_PARKOUR") {
        await importFailParkour(ctx, action);
    } else if (action.type === "TELEPORT") {
        await importTeleport(ctx, action);
    } else if (action.type === "SEND_TO_LOBBY") {
        await importSendToLobby(ctx, action);
    } else if (action.type === "GIVE_EXPERIENCE_LEVELS") {
        await importGiveExperienceLevels(ctx, action);
    } else if (action.type === "CLEAR_POTION_EFFECTS") {
        return;
    } else if (action.type === "CHANGE_MAX_HEALTH") {
        await importChangeMaxHealth(ctx, action);
    } else if (action.type === "CHANGE_HEALTH") {
        await importChangeHealth(ctx, action);
    } else if (action.type === "CHANGE_HUNGER") {
        await importChangeHunger(ctx, action);
    } else if (action.type === "DROP_ITEM") {
        await importDropItem(ctx, action);
    } else if (action.type === "SET_VELOCITY") {
        await importSetVelocity(ctx, action);
    } else if (action.type === "LAUNCH") {
        await importLaunch(ctx, action);
    } else if (action.type === "CANCEL_EVENT") {
        return;
    } else {
        const _exhaustiveCheck: never = action;
    }

    if (action.note) {
        await setValue(ctx, "Note", action.note);
        await waitForMenuToLoad(ctx);
    }

    goBack(ctx);
    await waitForMenuToLoad(ctx);
}

async function importChangeVar(
    ctx: TaskContext,
    action: ActionChangeVar,
): Promise<void> { }

async function importConditional(
    ctx: TaskContext,
    action: ActionConditional,
): Promise<void> { }

async function importSendMessage(
    ctx: TaskContext,
    action: ActionSendMessage,
): Promise<void> {
    await setValue(ctx, "Message", action.message);
    await waitForMenuToLoad(ctx);
}

async function importActionBar(
    ctx: TaskContext,
    action: ActionActionBar,
): Promise<void> { }

async function importPlaySound(
    ctx: TaskContext,
    action: ActionPlaySound,
): Promise<void> { }

async function importGiveItem(
    ctx: TaskContext,
    action: ActionGiveItem,
): Promise<void> { }

async function importTitle(
    ctx: TaskContext,
    action: ActionTitle,
): Promise<void> { }

async function importSetGroup(
    ctx: TaskContext,
    action: ActionSetGroup,
): Promise<void> { }

async function importRemoveItem(
    ctx: TaskContext,
    action: ActionRemoveItem,
): Promise<void> { }

async function importApplyPotionEffect(
    ctx: TaskContext,
    action: ActionApplyPotionEffect,
): Promise<void> { }

async function importDisplayMenu(
    ctx: TaskContext,
    action: ActionDisplayMenu,
): Promise<void> { }

async function importSetTeam(
    ctx: TaskContext,
    action: ActionSetTeam,
): Promise<void> { }

async function importPause(
    ctx: TaskContext,
    action: ActionPauseExecution,
): Promise<void> { }

async function importEnchantHeldItem(
    ctx: TaskContext,
    action: ActionEnchantHeldItem,
): Promise<void> { }

async function importApplyInventoryLayout(
    ctx: TaskContext,
    action: ActionApplyInventoryLayout,
): Promise<void> { }

async function importFunction(
    ctx: TaskContext,
    action: ActionFunction,
): Promise<void> { }

async function importRandom(
    ctx: TaskContext,
    action: ActionRandom,
): Promise<void> { }

async function importSetGamemode(
    ctx: TaskContext,
    action: ActionSetGamemode,
): Promise<void> { }

async function importSetCompassTarget(
    ctx: TaskContext,
    action: ActionSetCompassTarget,
): Promise<void> { }

async function importFailParkour(
    ctx: TaskContext,
    action: ActionFailParkour,
): Promise<void> { }

async function importTeleport(
    ctx: TaskContext,
    action: ActionTeleport,
): Promise<void> { }

async function importSendToLobby(
    ctx: TaskContext,
    action: ActionSendToLobby,
): Promise<void> { }

async function importGiveExperienceLevels(
    ctx: TaskContext,
    action: ActionGiveExperienceLevels,
): Promise<void> { }

async function importChangeMaxHealth(
    ctx: TaskContext,
    action: ActionChangeMaxHealth,
): Promise<void> { }

async function importChangeHealth(
    ctx: TaskContext,
    action: ActionChangeHealth,
): Promise<void> { }

async function importChangeHunger(
    ctx: TaskContext,
    action: ActionChangeHunger,
): Promise<void> { }

async function importDropItem(
    ctx: TaskContext,
    action: ActionDropItem,
): Promise<void> { }

async function importSetVelocity(
    ctx: TaskContext,
    action: ActionSetVelocity,
): Promise<void> { }

async function importLaunch(
    ctx: TaskContext,
    action: ActionLaunch,
): Promise<void> { }
