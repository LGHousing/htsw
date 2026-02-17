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
} from "htsw/types";
import { SOUNDS } from "htsw/types";

import type { Step } from "./step";
import { stepGoBack, stepsClickButtonThenSelectValue } from "./helpers";
import {
    stepClickSlot,
    stepSelectValue,
    stepsClickSlotThenSelect,
    stepsNumber,
    stepsString,
    stepsToggle,
} from "./stepHelpers";
import { stepsForCondition } from "./conditions";

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

export function stepsForAction(action: Action): Step[] {
    switch (action.type) {
        case "CHANGE_VAR":
            return stepsForChangeVar(action);
        case "CONDITIONAL":
            return stepsForConditional(action);
        case "MESSAGE":
            return stepsForMessage(action);
        case "PLAY_SOUND":
            return stepsForPlaySound(action);
        case "GIVE_ITEM":
            return stepsForGiveItem(action);
        case "TITLE":
            return stepsForTitle(action);
        case "EXIT":
            return stepsForSimple(action);
        case "SET_GROUP":
            return stepsForSetGroup(action);
        case "KILL":
            return stepsForSimple(action);
        case "HEAL":
            return stepsForSimple(action);
        case "ACTION_BAR":
            return stepsForActionBar(action);
        case "RESET_INVENTORY":
            return stepsForSimple(action);
        case "REMOVE_ITEM":
            return stepsForRemoveItem(action);
        case "APPLY_POTION_EFFECT":
            return stepsForApplyPotion(action);
        case "SET_MENU":
            return stepsForSetMenu(action);
        case "SET_TEAM":
            return stepsForSetTeam(action);
        case "PAUSE":
            return stepsForPause(action);
        case "ENCHANT_HELD_ITEM":
            return stepsForEnchant(action);
        case "APPLY_INVENTORY_LAYOUT":
            return stepsForApplyLayout(action);
        case "FUNCTION":
            return stepsForFunction(action);
        case "RANDOM":
            return stepsForRandom(action);
        case "SET_GAMEMODE":
            return stepsForSetGamemode(action);
        case "SET_COMPASS_TARGET":
            return stepsForSetCompassTarget(action);
        case "FAIL_PARKOUR":
            return stepsForFailParkour(action);
        case "TELEPORT":
            return stepsForTeleport(action);
        case "SEND_TO_LOBBY":
            return stepsForSendToLobby(action);
        case "GIVE_EXPERIENCE_LEVELS":
            return stepsForGiveExperienceLevels(action);
        case "CLEAR_POTION_EFFECTS":
            return stepsForSimple(action);
        case "CHANGE_MAX_HEALTH":
            return stepsForChangeMaxHealth(action);
        case "CHANGE_HEALTH":
            return stepsForChangeHealth(action);
        case "CHANGE_HUNGER":
            return stepsForChangeHunger(action);
        case "DROP_ITEM":
            return stepsForDropItem(action);
        case "SET_VELOCITY":
            return stepsForSetVelocity(action);
        case "LAUNCH":
            return stepsForLaunch(action);
        case "CANCEL_EVENT":
            return stepsForSimple(action);
        default:
            return [];
    }
}

function stepsForSimple(action: Action): Step[] {
    return [
        ...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]),
        stepGoBack(),
    ];
}

function stepsForChangeVar(action: ActionChangeVar): Step[] {
    const steps: Step[] = [];

    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));

    const holder = action.holder.type;
    const holderLabel = holder === "global" ? "Global" : holder === "team" ? "Team" : "Player";

    steps.push(...stepsClickSlotThenSelect(10, holderLabel));

    const slotShift = action.holder.type === "team" ? 1 : 0;

    if (action.holder.type === "team" && action.holder.team) {
        steps.push(...stepsClickSlotThenSelect(11, action.holder.team));
    }

    steps.push(...stepsString(11 + slotShift, action.key, "Kills"));

    if (action.op) {
        steps.push(...stepsClickSlotThenSelect(12 + slotShift, opToUi(action.op)));
    }

    if (action.value !== undefined) {
        steps.push(...stepsString(13 + slotShift, action.value, "1L"));
    }

    steps.push(...stepsToggle(14 + slotShift, action.unset, false));
    steps.push(stepGoBack());

    return steps;
}

function stepsForConditional(action: ActionConditional): Step[] {
    const steps: Step[] = [];

    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));

    if (action.conditions.length > 0) {
        steps.push(stepClickSlot(10));
        for (const condition of action.conditions) {
            steps.push(...stepsForCondition(condition));
        }
        steps.push(stepGoBack());
    }

    steps.push(...stepsToggle(11, action.matchAny, false));

    steps.push(...stepsForSubactions(12, action.ifActions));
    if (action.elseActions && action.elseActions.length > 0) {
        steps.push(...stepsForSubactions(13, action.elseActions));
    }

    steps.push(stepGoBack());

    return steps;
}

function stepsForSubactions(slot: number, actions: Action[]): Step[] {
    if (actions.length === 0) return [];

    const steps: Step[] = [];
    steps.push(stepClickSlot(slot));
    for (const action of actions) {
        steps.push(...stepsForAction(action));
    }
    steps.push(stepGoBack());
    return steps;
}

function stepsForMessage(action: ActionMessage): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsString(10, action.message, "Hello!"));
    steps.push(stepGoBack());
    return steps;
}

function stepsForActionBar(action: ActionActionBar): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsString(10, action.message, "Hello World!"));
    steps.push(stepGoBack());
    return steps;
}

function stepsForPlaySound(action: ActionPlaySound): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));

    if (action.sound) {
        steps.push(stepClickSlot(10));
        const soundName = soundPathToName(action.sound);
        if (soundName) {
            steps.push(stepSelectValue(soundName));
        } else {
            steps.push(stepSelectValue("Custom Sound"));
            steps.push(stepSelectValue(action.sound));
        }
    }

    steps.push(...stepsNumber(11, action.volume, 0.7));
    steps.push(...stepsNumber(12, action.pitch, 1));

    if (action.location) {
        steps.push(...stepsForLocation(13, action.location));
    }

    steps.push(stepGoBack());
    return steps;
}

function stepsForGiveItem(action: ActionGiveItem): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));

    if (action.item) {
        steps.push(stepClickSlot(10));
        steps.push({ type: "SELECT_ITEM", item: action.item });
    }
    steps.push(...stepsToggle(11, action.allowMultiple, false));

    if (action.slot !== undefined) {
        steps.push(...stepsForInventorySlot(12, action.slot));
    }
    steps.push(...stepsToggle(13, action.replaceExisting, false));
    steps.push(stepGoBack());
    return steps;
}

function stepsForTitle(action: ActionTitle): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsString(10, action.title, "Hello World!"));
    if (action.subtitle !== undefined) {
        steps.push(...stepsString(11, action.subtitle, ""));
    }
    steps.push(...stepsNumber(12, action.fadein, 1));
    steps.push(...stepsNumber(13, action.stay, 5));
    steps.push(...stepsNumber(14, action.fadeout, 1));
    steps.push(stepGoBack());
    return steps;
}

function stepsForSetGroup(action: ActionSetGroup): Step[] {
    const steps: Step[] = [];

    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsClickSlotThenSelect(10, action.group));
    steps.push(...stepsToggle(11, action.demotionProtection, true));
    steps.push(stepGoBack());

    return steps;
}

function stepsForRemoveItem(action: ActionRemoveItem): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));

    if (action.item) {
        steps.push(stepClickSlot(10));
        steps.push({ type: "SELECT_ITEM", item: action.item });
    }

    steps.push(stepGoBack());
    return steps;
}

function stepsForApplyPotion(action: ActionApplyPotionEffect): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));

    if (action.effect) {
        steps.push(...stepsClickSlotThenSelect(10, action.effect));
    }
    steps.push(...stepsNumber(11, action.duration, 60));
    steps.push(...stepsNumber(12, action.level, 1));
    steps.push(...stepsToggle(13, action.override, false));
    if (action.showIcon !== undefined) {
        steps.push(...stepsToggle(14, action.showIcon, false));
    }

    steps.push(stepGoBack());
    return steps;
}

function stepsForSetMenu(action: { menu: string }): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES["SET_MENU"]));
    steps.push(...stepsClickSlotThenSelect(10, action.menu));
    steps.push(stepGoBack());
    return steps;
}

function stepsForSetTeam(action: ActionSetTeam): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsClickSlotThenSelect(10, action.team));
    steps.push(stepGoBack());
    return steps;
}

function stepsForPause(action: ActionPauseExecution): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsNumber(10, action.ticks, 20));
    steps.push(stepGoBack());
    return steps;
}

function stepsForEnchant(action: { enchant: string; level: number }): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES["ENCHANT_HELD_ITEM"]));
    steps.push(...stepsClickSlotThenSelect(10, action.enchant));
    steps.push(...stepsNumber(11, action.level, 1));
    steps.push(stepGoBack());
    return steps;
}

function stepsForApplyLayout(action: ActionApplyInventoryLayout): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsClickSlotThenSelect(10, action.layout));
    steps.push(stepGoBack());
    return steps;
}

function stepsForFunction(action: ActionFunction): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsClickSlotThenSelect(10, action.function));
    steps.push(...stepsToggle(11, action.global, false));
    steps.push(stepGoBack());
    return steps;
}

function stepsForRandom(action: ActionRandom): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsForSubactions(10, action.actions));
    steps.push(stepGoBack());
    return steps;
}

function stepsForSetGamemode(action: ActionSetGamemode): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsClickSlotThenSelect(10, action.gamemode));
    steps.push(stepGoBack());
    return steps;
}

function stepsForSetCompassTarget(action: ActionSetCompassTarget): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsForLocation(10, action.location));
    steps.push(stepGoBack());
    return steps;
}

function stepsForFailParkour(action: ActionFailParkour): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    if (action.message !== undefined) {
        steps.push(...stepsString(10, action.message, "Failed!"));
    }
    steps.push(stepGoBack());
    return steps;
}

function stepsForTeleport(action: ActionTeleport): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsForLocation(10, action.location));
    steps.push(stepGoBack());
    return steps;
}

function stepsForSendToLobby(action: ActionSendToLobby): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    if (action.lobby) {
        steps.push(...stepsClickSlotThenSelect(10, action.lobby));
    }
    steps.push(stepGoBack());
    return steps;
}

function stepsForGiveExperienceLevels(action: ActionGiveExperienceLevels): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsNumber(10, action.amount, 1));
    steps.push(stepGoBack());
    return steps;
}

function stepsForChangeMaxHealth(action: ActionChangeMaxHealth): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsString(10, action.amount, "20"));
    if (action.op) {
        steps.push(...stepsClickSlotThenSelect(11, opToUi(action.op)));
    }
    steps.push(...stepsToggle(12, action.heal, true));
    steps.push(stepGoBack());
    return steps;
}

function stepsForChangeHealth(action: ActionChangeHealth): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsString(10, action.amount, "20"));
    if (action.op) {
        steps.push(...stepsClickSlotThenSelect(11, opToUi(action.op)));
    }
    steps.push(stepGoBack());
    return steps;
}

function stepsForChangeHunger(action: ActionChangeHunger): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsString(10, action.amount, "20"));
    if (action.op) {
        steps.push(...stepsClickSlotThenSelect(11, opToUi(action.op)));
    }
    steps.push(stepGoBack());
    return steps;
}

function stepsForDropItem(action: ActionDropItem): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(stepClickSlot(10));
    steps.push({ type: "SELECT_ITEM", item: action.item });

    if (action.location) {
        steps.push(...stepsForLocation(11, action.location));
    }
    steps.push(...stepsToggle(12, action.dropNaturally, true));
    steps.push(...stepsToggle(13, action.disableMerging, false));
    steps.push(...stepsToggle(14, action.prioritizePlayer, false));
    steps.push(...stepsToggle(15, action.inventoryFallback, false));
    steps.push(stepGoBack());
    return steps;
}

function stepsForSetVelocity(action: ActionSetVelocity): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsString(10, action.x, "10"));
    steps.push(...stepsString(11, action.y, "10"));
    steps.push(...stepsString(12, action.z, "10"));
    steps.push(stepGoBack());
    return steps;
}

function stepsForLaunch(action: ActionLaunch): Step[] {
    const steps: Step[] = [];
    steps.push(...stepsClickButtonThenSelectValue("Add Action", ACTION_DISPLAY_NAMES[action.type]));
    steps.push(...stepsForLocation(10, action.location));
    steps.push(...stepsNumber(11, action.strength, 2));
    steps.push(stepGoBack());
    return steps;
}

function stepsForLocation(slot: number, location: { type: string; value?: string }): Step[] {
    const steps: Step[] = [];

    steps.push(stepClickSlot(slot));
    if (location.type === "Custom Coordinates") {
        steps.push(stepSelectValue("Custom Coordinates"));
        if (location.value !== undefined) {
            steps.push(stepSelectValue(location.value));
        }
        return steps;
    }

    steps.push(stepSelectValue(location.type));
    return steps;
}

function stepsForInventorySlot(slot: number, value: number | string): Step[] {
    const steps: Step[] = [];

    if (typeof value === "number" || /^[0-9]+$/.test(value)) {
        steps.push(stepClickSlot(slot));
        steps.push(stepSelectValue("Manual Input"));
        steps.push(stepSelectValue(value.toString()));
        return steps;
    }

    steps.push(...stepsClickSlotThenSelect(slot, value.toString()));
    return steps;
}

function opToUi(op: string): string {
    return op === "Unset" ? "Unset" : op;
}

function soundPathToName(path: string): string | null {
    for (const sound of SOUNDS) {
        if (sound.path === path) return sound.name;
    }
    return null;
}
