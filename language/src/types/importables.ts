import type { Tag } from "../nbt";
import type { Action } from "./actions";
import type { Bounds, Event, MenuSlot } from "./types";

export type ImportableFunction = {
    type: "FUNCTION";
    name: string;
    /**
     * Optional so an import.json entry can carry just an icon/repeatTicks
     * without an `.htsl` reference. When omitted the importer leaves the
     * live function's action list untouched (it does NOT sync against an
     * empty list, which would wipe it) — see functions/import.ts.
     */
    actions?: Action[];
    repeatTicks?: number;
    icon?: FunctionIcon;
};

export type FunctionIcon = {
    item: string;
    count?: number;
    enchanted?: boolean;
};

export type ImportableRegion = {
    type: "REGION";
    name: string;
    bounds: Bounds;
    onEnterActions?: Action[];
    onExitActions?: Action[];
};

export type ImportableMenu = {
    type: "MENU";
    name: string;
    /**
     * Number of LINES (1..6). Total slot count = size * 9.
     * Optional — when omitted the importer leaves the menu's existing
     * size untouched (and on creation Housing's default applies).
     */
    size?: number;
    slots: MenuSlot[];
};

export type ImportableItem = {
    type: "ITEM";
    name: string;
    nbt: Tag;
    leftClickActions?: Action[];
    rightClickActions?: Action[];
};

export type ImportableEvent = {
    type: "EVENT";
    event: Event;
    actions: Action[];
}

export type NpcSkin = "Steve" | "Alex" | "Players Skin";

export type NpcEquipment = {
    helmet?: string;
    chestplate?: string;
    leggings?: string;
    boots?: string;
    hand?: string;
};

export type ImportableNpc = {
    type: "NPC";
    name: string;
    pos: { x: number; y: number; z: number };
    leftClickActions?: Action[];
    rightClickActions?: Action[];
    lookAtPlayers?: boolean;
    hideNameTag?: boolean;
    skin?: NpcSkin;
    equipment?: NpcEquipment;
};

export type Importable =
    | ImportableFunction
    | ImportableRegion
    | ImportableMenu
    | ImportableItem
    | ImportableEvent
    | ImportableNpc;
