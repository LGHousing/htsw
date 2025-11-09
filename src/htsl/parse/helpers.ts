import { Span } from "../../span";
import type { Action, Comparison, Condition, Operation, VarOperation } from "../../types";

export const ACTION_KWS = [
    "applyLayout",
    "applyPotion",
    "balanceTeam",
    "cancelEvent",
    "changeHealth",
    "hungerLevel",
    "maxHealth",
    "changePlayerGroup",
    "clearEffects",
    "closeMenu",
    "actionBar",
    "displayMenu",
    "title",
    "enchant",
    "exit",
    "failParkour",
    "fullHeal",
    "xpLevel",
    "giveItem",
    "houseSpawn",
    "kill",
    "parkCheck",
    "pause",
    "sound",
    "removeItem",
    "resetInventory",
    "chat",
    "lobby",
    "compassTarget",
    "gamemode",
    "setTeam",
    "tp",
    "consumeItem",
    "stat",
    "globalstat",
    "teamstat",
    "launch",
    "changeVelocity",
    "dropItem",
    "function",
    "random",
    "if",
    "var",
    "globalvar",
    "teamvar",
] as const;

export type ActionKey = Action["type"];
export type ActionKw = (typeof ACTION_KWS)[number];

export const CONDITION_KWS = [
    "blockType",
    "damageAmount",
    "damageCause",
    "doingParkour",
    "fishingEnv",
    "hasItem",
    "hasPotion",
    "isItem",
    "isSneaking",
    "maxHealth",
    "isFlying",
    "health",
    "hunger",
    "portal",
    "canPvp",
    "gamemode",
    "hasGroup",
    "hasPermission",
    "hasTeam",
    "inRegion",
    "stat",
    "globalstat",
    "teamstat",
    "placeholder",
    "var",
    "globalvar",
    "teamvar",
] as const;

export type ConditionKey = Condition["type"];
export type ConditionKw = (typeof CONDITION_KWS)[number];

export const ACTIONS_TO_KWS: {
    [key in Action["type"]]: ActionKw;
} = {
    ACTION_BAR: "actionBar",
    APPLY_INVENTORY_LAYOUT: "applyLayout",
    APPLY_POTION_EFFECT: "applyPotion",
    CANCEL_EVENT: "cancelEvent",
    CHANGE_HEALTH: "changeHealth",
    CHANGE_HUNGER: "hungerLevel",
    CHANGE_MAX_HEALTH: "maxHealth",
    CHANGE_VAR: "var",
    CLEAR_POTION_EFFECTS: "clearEffects",
    CONDITIONAL: "if",
    DROP_ITEM: "dropItem",
    ENCHANT_HELD_ITEM: "enchant",
    EXIT: "exit",
    FAIL_PARKOUR: "failParkour",
    FUNCTION: "function",
    GIVE_EXPERIENCE_LEVELS: "xpLevel",
    GIVE_ITEM: "giveItem",
    HEAL: "fullHeal",
    KILL: "kill",
    LAUNCH: "launch",
    MESSAGE: "chat",
    PAUSE: "pause",
    PLAY_SOUND: "sound",
    RANDOM: "random",
    REMOVE_ITEM: "removeItem",
    RESET_INVENTORY: "resetInventory",
    SEND_TO_LOBBY: "lobby",
    SET_COMPASS_TARGET: "compassTarget",
    SET_GAMEMODE: "gamemode",
    SET_GROUP: "changePlayerGroup",
    SET_MENU: "displayMenu",
    SET_TEAM: "setTeam",
    SET_VELOCITY: "changeVelocity",
    TELEPORT: "tp",
    TITLE: "title",
};

export const CONDITIONS_TO_KWS: {
    [key in Condition["type"]]: ConditionKw;
} = {
    COMPARE_DAMAGE: "damageAmount",
    COMPARE_HEALTH: "health",
    COMPARE_HUNGER: "hunger",
    COMPARE_MAX_HEALTH: "maxHealth",
    COMPARE_PLACEHOLDER: "placeholder",
    COMPARE_VAR: "var",
    IS_DOING_PARKOUR: "doingParkour",
    IS_FLYING: "isFlying",
    IS_IN_REGION: "inRegion",
    IS_SNEAKING: "isSneaking",
    REQUIRE_GAMEMODE: "gamemode",
    REQUIRE_GROUP: "hasGroup",
    REQUIRE_ITEM: "hasItem",
    REQUIRE_PERMISSION: "hasPermission",
    REQUIRE_POTION_EFFECT: "hasPotion",
    REQUIRE_TEAM: "hasTeam",
};

export const OPERATION_SYMBOLS: {
    [key in VarOperation]: string;
} = {
    Set: "=",
    Increment: "+=",
    Decrement: "-=",
    Multiply: "*=",
    Divide: "/=",
    "Shift Left": "<<=",
    "Shift Right": ">>=",
    "And Assign": "&=",
    "Or Assign": "|=",
    "Xor Assign": "^=",
    Unset: "unset"
};

export const COMPARISON_SYMBOLS: {
    [key in Comparison]: string;
} = {
    Equal: "==",
    "Less Than": "<",
    "Less Than Or Equal": "<=",
    "Greater Than": ">",
    "Greater Than Or Equal": ">=",
};

export const SHORTHANDS = [
    "globalstat",
    "stat",
    "teamstat",
    "globalvar",
    "var",
    "teamvar",
    "randomint",
    "health",
    "maxHealth",
    "hunger",
    "locX",
    "locY",
    "locZ",
    "unix",
] as const;

export type ShorthandKw = (typeof SHORTHANDS)[number];

export function withDummyTypeSpans<T extends object>(
    object: T
): T & { typeSpan: Span, span: Span } {
    return {
        ...object,
        typeSpan: Span.dummy(),
        span: Span.dummy(),
    } as const;
}