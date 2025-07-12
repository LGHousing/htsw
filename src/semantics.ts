import type { Action, Condition } from 'housing-common/src/types';

export type SemanticKind =
    | 'var_holder'
    | 'var_name'
    | 'team_name'
    | 'amount'
    | 'operation'
    | 'comparison'
    | 'string'
    | 'boolean'
    | 'number'
    | 'conditional_mode'
    | 'conditions'
    | 'actions'
    | 'location'
    | 'gamemode'
    | 'item'
    | 'potion'
    | 'lobby'
    | 'enchantment'
    | 'sound'
    | 'inversion'
    | 'placeholder'
    | 'region_name'
    | 'permission'
    | 'item_amount'
    | 'item_property'
    | 'item_location'
    | 'group_name';

export const CONDITION_SEMANTIC_DESCRIPTORS: {
    [K in Condition['type']]: {
        [key in keyof Omit<Extract<Condition, { type: K }>, 'type'>]-?: SemanticKind;
    };
} = {
    COMPARE_HEALTH: {
        op: 'operation',
        amount: 'amount',
        inverted: 'inversion',
    },
    COMPARE_HUNGER: {
        op: 'operation',
        amount: 'amount',
        inverted: 'inversion',
    },
    COMPARE_MAX_HEALTH: {
        op: 'operation',
        amount: 'amount',
        inverted: 'inversion',
    },
    COMPARE_PLACEHOLDER: {
        placeholder: 'placeholder',
        op: 'operation',
        amount: 'amount',
        inverted: 'inversion',
    },
    IS_DOING_PARKOUR: {
        inverted: 'boolean',
    },
    IS_FLYING: {
        inverted: 'boolean',
    },
    IS_IN_REGION: {
        inverted: 'boolean',
        region: 'region_name',
    },
    IS_SNEAKING: {
        inverted: 'boolean',
    },
    REQUIRE_GROUP: {
        inverted: 'boolean',
        group: 'group_name',
        includeHigherGroups: 'boolean',
    },
    REQUIRE_ITEM: {
        inverted: 'boolean',
        item: 'item',
        amount: 'item_amount',
        whatToCheck: 'item_property',
        whereToCheck: 'item_location',
    },
    REQUIRE_PERMISSION: {
        inverted: 'boolean',
        permission: 'permission',
    },
    REQUIRE_POTION_EFFECT: {
        inverted: 'boolean',
        effect: 'potion',
    },
    REQUIRE_TEAM: {
        inverted: 'boolean',
        team: 'team_name',
    },
    COMPARE_VAR: {
        holder: 'var_holder',
        amount: 'amount',
        var: 'var_name',
        op: 'operation',
        fallback: 'amount',
        inverted: 'inversion',
    },
    REQUIRE_GAMEMODE: {
        gamemode: 'gamemode',
        inverted: 'inversion',
    },
    COMPARE_DAMAGE: {
        op: 'comparison',
        amount: 'amount',
        inverted: 'inversion',
    },
};

export const ACTION_SEMANTIC_DESCRIPTORS: {
    [K in Action['type']]: {
        [key in keyof Omit<Extract<Action, { type: K }>, 'type'>]-?: SemanticKind;
    };
} = {
    APPLY_INVENTORY_LAYOUT: {
        layout: 'string',
    },
    CHANGE_HUNGER: {
        amount: 'operation',
        op: 'amount',
    },
    DROP_ITEM: {
        location: 'location',
        item: 'item',
        dropNaturally: 'boolean',
        disableMerging: 'boolean',
        prioritizePlayer: 'boolean',
        inventoryFallback: 'boolean',
    },
    ENCHANT_HELD_ITEM: {
        enchant: 'enchantment',
        level: 'number',
    },
    FUNCTION: {
        function: 'string',
        global: 'boolean',
    },
    LAUNCH: {
        location: 'location',
        strength: 'amount',
    },
    PAUSE: {
        ticks: 'amount',
    },
    PLAY_SOUND: {
        location: 'location',
        sound: 'sound',
        volume: 'number',
        pitch: 'number',
    },
    SET_COMPASS_TARGET: {
        location: 'location',
    },
    SET_GAMEMODE: {
        gamemode: 'gamemode',
    },
    SET_MENU: {
        menu: 'string',
    },
    SET_TEAM: {
        team: 'team_name',
    },
    CONDITIONAL: {
        matchAny: 'conditional_mode',
        conditions: 'conditions',
        ifActions: 'actions',
        elseActions: 'actions',
    },
    SET_GROUP: {
        group: 'string',
        demotionProtection: 'boolean',
    },
    KILL: {},
    HEAL: {},
    TITLE: {
        title: 'string',
        subtitle: 'string',
        fadein: 'number',
        stay: 'number',
        fadeout: 'number',
    },
    ACTION_BAR: {
        message: 'string',
    },
    RESET_INVENTORY: {},
    CHANGE_MAX_HEALTH: {
        op: 'operation',
        amount: 'amount',
        heal: 'boolean',
    },
    CHANGE_VAR: {
        holder: 'var_holder',
        var: 'var_name',
        op: 'operation',
        value: 'amount',
        unset: 'boolean',
    },
    CHANGE_HEALTH: {
        op: 'operation',
        amount: 'amount',
    },
    MESSAGE: {
        message: 'string',
    },
    RANDOM: {
        actions: 'actions',
    },
    SET_VELOCITY: {
        x: 'number',
        y: 'number',
        z: 'number',
    },
    TELEPORT: {
        location: 'location',
    },
    EXIT: {},
    CANCEL_EVENT: {},
    GIVE_ITEM: {
        replaceExisting: 'boolean',
        item: 'item',
        allowMultiple: 'boolean',
        slot: 'number',
    },
    REMOVE_ITEM: {
        item: 'item',
    },
    APPLY_POTION_EFFECT: {
        effect: 'potion',
        duration: 'number',
        level: 'number',
        override: 'boolean',
        showIcon: 'boolean',
    },
    CLEAR_POTION_EFFECTS: {},
    GIVE_EXPERIENCE_LEVELS: {
        amount: 'amount',
    },
    SEND_TO_LOBBY: {
        lobby: 'lobby',
    },
    FAIL_PARKOUR: {
        message: 'string',
    },
};
