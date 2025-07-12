import type { Action, Comparison, Condition, Operation } from 'housing-common/src/types';

export const ACTION_KWS = [
    'applyLayout',
    'applyPotion',
    'balanceTeam',
    'cancelEvent',
    'changeHealth',
    'hungerLevel',
    'maxHealth',
    'changePlayerGroup',
    'clearEffects',
    'closeMenu',
    'actionBar',
    'displayMenu',
    'title',
    'enchant',
    'exit',
    'failParkour',
    'fullHeal',
    'xpLevel',
    'giveItem',
    'houseSpawn',
    'kill',
    'parkCheck',
    'pause',
    'sound',
    'removeItem',
    'resetInventory',
    'chat',
    'lobby',
    'compassTarget',
    'gamemode',
    'setTeam',
    'tp',
    'consumeItem',
    'stat',
    'globalstat',
    'teamstat',
    'launch',
    'changeVelocity',
    'dropItem',
    'function',
    'random',
    'if',
    'var',
    'globalvar',
    'teamvar',
] as const;

export type ActionKey = Action["type"];
export type ActionKw = (typeof ACTION_KWS)[number];

export const CONDITION_KWS = [
    'blockType',
    'damageAmount',
    'damageCause',
    'doingParkour',
    'fishingEnv',
    'hasItem',
    'hasPotion',
    'isItem',
    'isSneaking',
    'maxHealth',
    'isFlying',
    'health',
    'hunger',
    'portal',
    'canPvp',
    'gamemode',
    'hasGroup',
    'hasPermission',
    'hasTeam',
    'inRegion',
    'stat',
    'globalstat',
    'teamstat',
    'placeholder',
    'var',
    'globalvar',
    'teamvar',
] as const;

export type ConditionKey = Condition["type"];
export type ConditionKw = (typeof CONDITION_KWS)[number];

export const ACTIONS_TO_KWS: {
    [key in Action['type']]: ActionKw;
} = {
    ACTION_BAR: 'actionBar',
    APPLY_INVENTORY_LAYOUT: 'applyLayout',
    APPLY_POTION_EFFECT: 'applyPotion',
    CANCEL_EVENT: 'cancelEvent',
    CHANGE_HEALTH: 'changeHealth',
    CHANGE_HUNGER: 'hungerLevel',
    CHANGE_MAX_HEALTH: 'maxHealth',
    CHANGE_VAR: 'var',
    CLEAR_POTION_EFFECTS: 'clearEffects',
    CONDITIONAL: 'if',
    DROP_ITEM: 'dropItem',
    ENCHANT_HELD_ITEM: 'enchant',
    EXIT: 'exit',
    FAIL_PARKOUR: 'failParkour',
    FUNCTION: 'function',
    GIVE_EXPERIENCE_LEVELS: 'xpLevel',
    GIVE_ITEM: 'giveItem',
    HEAL: 'fullHeal',
    KILL: 'kill',
    LAUNCH: 'launch',
    MESSAGE: 'chat',
    PAUSE: 'pause',
    PLAY_SOUND: 'sound',
    RANDOM: 'random',
    REMOVE_ITEM: 'removeItem',
    RESET_INVENTORY: 'resetInventory',
    SEND_TO_LOBBY: 'lobby',
    SET_COMPASS_TARGET: 'compassTarget',
    SET_GAMEMODE: 'gamemode',
    SET_GROUP: 'changePlayerGroup',
    SET_MENU: 'displayMenu',
    SET_TEAM: 'setTeam',
    SET_VELOCITY: 'changeVelocity',
    TELEPORT: 'tp',
    TITLE: 'title',
};

export const CONDITIONS_TO_KWS: {
    [key in Condition['type']]: ConditionKw;
} = {
    COMPARE_DAMAGE: 'damageAmount',
    COMPARE_HEALTH: 'health',
    COMPARE_HUNGER: 'hunger',
    COMPARE_MAX_HEALTH: 'maxHealth',
    COMPARE_PLACEHOLDER: 'placeholder',
    COMPARE_VAR: 'var',
    IS_DOING_PARKOUR: 'doingParkour',
    IS_FLYING: 'isFlying',
    IS_IN_REGION: 'inRegion',
    IS_SNEAKING: 'isSneaking',
    REQUIRE_GAMEMODE: 'gamemode',
    REQUIRE_GROUP: 'hasGroup',
    REQUIRE_ITEM: 'hasItem',
    REQUIRE_PERMISSION: 'hasPermission',
    REQUIRE_POTION_EFFECT: 'hasPotion',
    REQUIRE_TEAM: 'hasTeam',
};

export const OPERATION_SYMBOLS: {
    [key in Operation]: string;
} = {
    increment: '+=',
    decrement: '-=',
    set: '=',
    multiply: '*=',
    divide: '/=',
};

export const COMPARISON_SYMBOLS: {
    [key in Comparison]: string;
} = {
    less_than: '<',
    less_than_or_equals: '<=',
    equals: '==',
    greater_than: '>',
    greater_than_or_equals: '>=',
};

export const SHORTHANDS = [
    'globalstat',
    'stat',
    'teamstat',
    'randomint',
    'health',
    'maxHealth',
    'hunger',
    'locX',
    'locY',
    'locZ',
    'unix',
] as const;

export function partialEq(src: any, target: any): boolean {
    return Object.keys(target).every((key) => {
        return target[key] === src[key];
    });
}

export function nullableFn<T, R>(fn: (value: T) => R): (value: T | undefined) => R | undefined {
    return (value: T | undefined) => {
        if (!value) return;
        return fn(value);
    }
}