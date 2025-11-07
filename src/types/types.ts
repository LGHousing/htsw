import {
    COMPARISONS,
    ENCHANTMENTS,
    EVENTS,
    GAMEMODES,
    INVENTORY_SLOTS,
    ITEM_AMOUNTS,
    ITEM_LOCATIONS,
    ITEM_PROPERTIES,
    LOBBIES,
    OPERATIONS,
    PERMISSIONS,
    POTION_EFFECTS,
    SOUNDS,
    type Action,
} from ".";

export type Value = string;
export type VarName = string;

export type VarHolder =
    | { type: "player" }
    | { type: "global" }
    | { type: "team"; team: string };

export type Nbt = string;

export type Operation = (typeof OPERATIONS)[number];
export type Comparison = (typeof COMPARISONS)[number];

export type Gamemode = (typeof GAMEMODES)[number];
export type PotionEffect = (typeof POTION_EFFECTS)[number];
export type Event = (typeof EVENTS)[number];
export type Lobby = (typeof LOBBIES)[number];
export type Enchantment = (typeof ENCHANTMENTS)[number];
export type Sound = (typeof SOUNDS)[number]["path"];
export type Permission = (typeof PERMISSIONS)[number];

export type InventorySlot = (typeof INVENTORY_SLOTS)[number] | number; // -1 to 39

export type ItemProperty = (typeof ITEM_PROPERTIES)[number];
export type ItemLocation = (typeof ITEM_LOCATIONS)[number];
export type ItemAmount = (typeof ITEM_AMOUNTS)[number];

export type Location =
    | { type: "House Spawn Location" }
    | { type: "Invokers Location" }
    | { type: "Current Location" }
    | { type: "Custom Coordinates", value: string };

export type AABB = {
    x1: number;
    y1: number;
    z1: number;
    x2: number;
    y2: number;
    z2: number;
};

export type MenuSlot = {
    slot: number;
    snbt: string;
    actions?: Action[];
};