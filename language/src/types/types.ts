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
    VAR_OPERATIONS,
    type Action,
} from ".";
import type { Tag } from "../nbt";

export type ButtonType = "left" | "right" | "middle";
export type Value = string;
export type VarName = string;

export type VarHolder =
    | { type: "Player" }
    | { type: "Global" }
    | { type: "Team"; team?: string }; // Team can be optional in some housing flows.

export type Operation = (typeof OPERATIONS)[number];
export type VarOperation = Operation | (typeof VAR_OPERATIONS)[number];
export type Comparison = (typeof COMPARISONS)[number];

export type Gamemode = (typeof GAMEMODES)[number];
export type PotionEffect = (typeof POTION_EFFECTS)[number];
export type Event = (typeof EVENTS)[number];
export type Lobby = (typeof LOBBIES)[number];
export type Enchantment = (typeof ENCHANTMENTS)[number];
export type Sound = (typeof SOUNDS)[number]["path"];
export type Permission = (typeof PERMISSIONS)[number];
export type DamageCause = string;
export type FishingEnvironment = string;
export type PortalType = string;

export type InventorySlot = (typeof INVENTORY_SLOTS)[number] | number; // -1 to 39

export type ItemProperty = (typeof ITEM_PROPERTIES)[number];
export type ItemLocation = (typeof ITEM_LOCATIONS)[number];
export type ItemAmount = (typeof ITEM_AMOUNTS)[number];

export type Location =
    | { type: "House Spawn Location" }
    | { type: "Invokers Location" }
    | { type: "Current Location" }
    | { type: "Custom Coordinates", value: string };

export type Bounds = {
    from: Pos;
    to: Pos;
};

export type Pos = {
    x: number;
    y: number;
    z: number;
}

export type MenuSlot = {
    slot: number;
    nbt: Tag;
    actions?: Action[];
};
