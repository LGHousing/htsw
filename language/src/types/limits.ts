import type { Action } from "./actions";
import type { Condition } from "./conditions";

export type ActionLimitContext = {
    importable: "functions" | "events" | "items" | "menus" | "regions" | "npcs";
    eventName?: string;
    nested?: "conditional" | "random";
};

export const ACTION_LIMITS: Partial<Record<Action["type"], number>> = {
    CONDITIONAL: 25,
    SET_GROUP: 1,
    KILL: 1,
    HEAL: 5,
    TITLE: 5,
    ACTION_BAR: 5,
    RESET_INVENTORY: 1,
    CHANGE_MAX_HEALTH: 5,
    PARKOUR_CHECKPOINT: 1,
    GIVE_ITEM: 40,
    REMOVE_ITEM: 40,
    MESSAGE: 20,
    APPLY_POTION_EFFECT: 22,
    CLEAR_POTION_EFFECTS: 5,
    GIVE_EXPERIENCE_LEVELS: 5,
    SEND_TO_LOBBY: 1,
    CHANGE_VAR: 25,
    TELEPORT: 5,
    FAIL_PARKOUR: 1,
    PLAY_SOUND: 25,
    SET_COMPASS_TARGET: 5,
    SET_GAMEMODE: 1,
    CHANGE_HEALTH: 5,
    CHANGE_HUNGER: 5,
    RANDOM: 25,
    FUNCTION: 10,
    APPLY_INVENTORY_LAYOUT: 5,
    ENCHANT_HELD_ITEM: 24,
    PAUSE: 30,
    SET_TEAM: 1,
    SET_MENU: 10,
    DROP_ITEM: 5,
    SET_VELOCITY: 5,
    LAUNCH: 5,
    SET_PLAYER_WEATHER: 5,
    SET_PLAYER_TIME: 5,
    TOGGLE_NAMETAG_DISPLAY: 5,
    EXIT: 1,
    CANCEL_EVENT: 1,
    CLOSE_MENU: 1,
    USE_HELD_ITEM: 1,
};

export const CONDITION_LIMITS: Partial<Record<Condition["type"], number>> = {
    REQUIRE_GROUP: 20,
    COMPARE_VAR: 20,
    REQUIRE_PERMISSION: 20,
    IS_IN_REGION: 20,
    REQUIRE_ITEM: 20,
    IS_DOING_PARKOUR: 1,
    REQUIRE_POTION_EFFECT: 22,
    IS_SNEAKING: 20,
    IS_FLYING: 20,
    COMPARE_HEALTH: 20,
    COMPARE_MAX_HEALTH: 20,
    COMPARE_HUNGER: 20,
    REQUIRE_GAMEMODE: 20,
    COMPARE_PLACEHOLDER: 20,
    REQUIRE_TEAM: 20,
    PVP_ENABLED: 20,
    FISHING_ENVIRONMENT: 20,
    PORTAL_TYPE: 20,
    DAMAGE_CAUSE: 20,
    COMPARE_DAMAGE: 20,
    BLOCK_TYPE: 20,
    IS_ITEM: 20,
};

export function getActionLimit(
    type: Action["type"],
    context: ActionLimitContext,
): number | undefined {
    if (
        type === "CONDITIONAL" &&
        context.importable === "events" &&
        context.nested === undefined
    ) {
        return 40;
    }

    return ACTION_LIMITS[type];
}

export function getConditionLimit(type: Condition["type"]): number | undefined {
    return CONDITION_LIMITS[type];
}
