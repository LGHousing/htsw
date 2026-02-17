import type { Condition } from "./conditions";
import type {
    Value,
    Enchantment,
    Gamemode,
    InventorySlot,
    Lobby,
    Location,
    Nbt,
    Operation,
    PotionEffect,
    Sound,
    VarName,
    VarHolder,
    VarOperation,
} from "./types";

export type ActionConditional = {
    type: "CONDITIONAL";
    matchAny: boolean;
    conditions: Condition[];
    ifActions: Action[];
    elseActions?: Action[];
};

export type ActionSetGroup = {
    type: "SET_GROUP";
    group: string;
    demotionProtection?: boolean;
};

export type ActionKill = {
    type: "KILL";
};

export type ActionHeal = {
    type: "HEAL";
};

export type ActionTitle = {
    type: "TITLE";
    title: string;
    subtitle?: string;
    fadein?: number;
    stay?: number;
    fadeout?: number;
};

export type ActionActionBar = {
    type: "ACTION_BAR";
    message: string;
};

export type ActionResetInventory = {
    type: "RESET_INVENTORY";
};

export type ActionChangeMaxHealth = {
    type: "CHANGE_MAX_HEALTH";
    op: Operation;
    amount: Value;
    heal?: boolean;
};

export type ActionGiveItem = {
    type: "GIVE_ITEM";
    item?: Nbt;
    allowMultiple?: boolean;
    slot?: InventorySlot;
    replaceExisting?: boolean;
};

export type ActionRemoveItem = {
    type: "REMOVE_ITEM";
    item?: Nbt;
};

export type ActionMessage = {
    type: "MESSAGE";
    message: string;
};

export type ActionApplyPotionEffect = {
    type: "APPLY_POTION_EFFECT";
    effect: PotionEffect;
    duration: number;
    level?: number;
    override?: boolean;
    showIcon?: boolean;
};

export type ActionClearPotionEffects = {
    type: "CLEAR_POTION_EFFECTS";
};

export type ActionGiveExperienceLevels = {
    type: "GIVE_EXPERIENCE_LEVELS";
    amount: Value;
};

export type ActionSendToLobby = {
    type: "SEND_TO_LOBBY";
    lobby?: Lobby;
};

export type ActionChangeVar = {
    type: "CHANGE_VAR";
    holder: VarHolder;
    key: VarName;
    op: VarOperation;
    value: Value;
    unset?: boolean;
};

export type ActionTeleport = {
    type: "TELEPORT";
    location: Location;
};

export type ActionFailParkour = {
    type: "FAIL_PARKOUR";
    message?: string;
};

export type ActionPlaySound = {
    type: "PLAY_SOUND";
    sound: Sound;
    volume?: number;
    pitch?: number;
    location?: Location;
};

export type ActionSetCompassTarget = {
    type: "SET_COMPASS_TARGET";
    location: Location;
};

export type ActionSetGamemode = {
    type: "SET_GAMEMODE";
    gamemode: Gamemode;
};

export type ActionChangeHealth = {
    type: "CHANGE_HEALTH";
    op: Operation;
    amount: Value;
};

export type ActionChangeHunger = {
    type: "CHANGE_HUNGER";
    op: Operation;
    amount: Value;
};

export type ActionRandom = {
    type: "RANDOM";
    actions: Action[];
};

export type ActionFunction = {
    type: "FUNCTION";
    function: string;
    global?: boolean;
};

export type ActionApplyInventoryLayout = {
    type: "APPLY_INVENTORY_LAYOUT";
    layout: string;
};

export type ActionEnchantHeldItem = {
    type: "ENCHANT_HELD_ITEM";
    enchant: Enchantment;
    level: number;
};

export type ActionPauseExecution = {
    type: "PAUSE";
    ticks: number;
};

export type ActionSetTeam = {
    type: "SET_TEAM";
    team: string;
};

export type ActionDisplayMenu = {
    type: "SET_MENU";
    menu: string;
};

export type ActionDropItem = {
    type: "DROP_ITEM";
    item: Nbt;
    location?: Location;
    dropNaturally?: boolean;
    disableMerging?: boolean;
    prioritizePlayer?: boolean;
    inventoryFallback?: boolean;
};

export type ActionSetVelocity = {
    type: "SET_VELOCITY";
    x: Value;
    y: Value;
    z: Value;
};

export type ActionLaunch = {
    type: "LAUNCH";
    location: Location;
    strength: number;
};

export type ActionExit = {
    type: "EXIT";
};

export type ActionCancelEvent = {
    type: "CANCEL_EVENT";
};

export type Action = (
    | ActionConditional
    | ActionSetGroup
    | ActionKill
    | ActionHeal
    | ActionTitle
    | ActionActionBar
    | ActionResetInventory
    | ActionChangeMaxHealth
    | ActionGiveItem
    | ActionRemoveItem
    | ActionMessage
    | ActionApplyPotionEffect
    | ActionClearPotionEffects
    | ActionGiveExperienceLevels
    | ActionSendToLobby
    | ActionChangeVar
    | ActionTeleport
    | ActionFailParkour
    | ActionPlaySound
    | ActionSetCompassTarget
    | ActionSetGamemode
    | ActionChangeHealth
    | ActionChangeHunger
    | ActionRandom
    | ActionFunction
    | ActionApplyInventoryLayout
    | ActionEnchantHeldItem
    | ActionPauseExecution
    | ActionSetTeam
    | ActionDisplayMenu
    | ActionDropItem
    | ActionSetVelocity
    | ActionLaunch
    | ActionExit
    | ActionCancelEvent
) & { note?: string };
