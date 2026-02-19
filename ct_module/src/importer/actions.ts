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
    ActionMessage,
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
import { MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../helpers";
import { importCondition } from "./conditions";

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

type ScannedAction = {
    slot: number;
    typeName: string;
    lore: string[];
};

export function actionDisplayName(type: Action["type"]): string {
    return ACTION_DISPLAY_NAMES[type];
}

function getCurrentActions(ctx: TaskContext): ScannedAction[] {
    const slots = ctx.getItemSlots();
    if (slots == null) {
        throw new Error("No open container found");
    }

    const actions: ScannedAction[] = [];

    for (const slot of slots) {
        const rawName = removedFormatting(slot.getItem().getName()).trim();
        const lore = slot.getItem().getLore?.() ?? [];
        if (lore.length === 0) continue;

        const cleanedLore = lore.map((line) => removedFormatting(String(line)).trim());
        const isRemovableAction = cleanedLore.some((line) =>
            line.toLowerCase().includes("right click to remove")
        );
        if (!isRemovableAction) continue;

        const firstLore = cleanedLore[0] ?? rawName;
        const typeName = firstLore.replace(/\s+\(#\d+\)\s*$/, "").trim();

        actions.push({
            slot: slot.getSlotId(),
            typeName,
            lore: cleanedLore,
        });
    }

    actions.sort((a, b) => a.slot - b.slot);
    return actions;
}

function actionAlreadyMatches(desired: Action, existing: ScannedAction): boolean {
    if (desired.type === "MESSAGE") {
        const expected = `Message: ${desired.message}`.trim();
        return existing.lore.some((line) => line.trim() === expected);
    }
    return false;
}

async function clickSlotIndex(
    ctx: TaskContext,
    slotId: number,
    button: MouseButton = MouseButton.LEFT,
    waitForMenu: boolean = true
): Promise<void> {
    const container = Player.getContainer();
    if (container == null) {
        throw new Error("No open container found");
    }

    const wait = waitForMenu ? waitForMenuToLoad(ctx) : Promise.resolve();
    container.click(slotId, false, button.valueOf());
    await wait;
}

async function importActionSettings(ctx: TaskContext, action: Action): Promise<void> {
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

export async function importAction(ctx: TaskContext, action: Action): Promise<void> {
    await clickSlot(ctx, "Add Action");
    await clickSlotPaginate(ctx, ACTION_DISPLAY_NAMES[action.type]);
    await importActionSettings(ctx, action);
}

export async function importActionsDiff(
    ctx: TaskContext,
    desiredActions: Action[]
): Promise<void> {
    let index = 0;

    while (true) {
        const current = getCurrentActions(ctx);

        if (index >= desiredActions.length) {
            if (current.length <= index) {
                return;
            }

            const trailing = current[current.length - 1];
            await clickSlotIndex(ctx, trailing.slot, MouseButton.RIGHT);
            continue;
        }

        const desired = desiredActions[index];
        const expectedType = actionDisplayName(desired.type);
        const existing = current[index];

        if (!existing) {
            await importAction(ctx, desired);
            index++;
            continue;
        }

        if (existing.typeName !== expectedType) {
            await clickSlotIndex(ctx, existing.slot, MouseButton.RIGHT);
            continue;
        }

        if (actionAlreadyMatches(desired, existing)) {
            index++;
            continue;
        }

        await clickSlotIndex(ctx, existing.slot, MouseButton.LEFT);
        await importActionSettings(ctx, desired);
        index++;
    }
}

async function importChangeVar(
    ctx: TaskContext,
    action: ActionChangeVar
): Promise<void> {}

async function importConditional(
    ctx: TaskContext,
    action: ActionConditional
): Promise<void> {
    if (action.conditions.length > 0) {
        await clickSlot(ctx, "Conditions");
        for (const condition of action.conditions) {
            await importCondition(ctx, condition);
        }
        await goBack(ctx);
    }

    await setValue(ctx, "Match Any Condition", action.matchAny);

    await clickSlot(ctx, "If Actions");
    await importActionsDiff(ctx, action.ifActions);
    await goBack(ctx);

    await clickSlot(ctx, "Else Actions");
    await importActionsDiff(ctx, action.elseActions ?? []);
    await goBack(ctx);

    await goBack(ctx);
}

async function importSendMessage(
    ctx: TaskContext,
    action: ActionMessage
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
