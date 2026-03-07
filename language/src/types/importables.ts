import type { Tag } from "../nbt";
import type { Action } from "./actions";
import type { Bounds, Event, MenuSlot } from "./types";

export type ImportableFunction = {
    type: "FUNCTION";
    name: string;
    actions: Action[];
    repeatTicks?: number;
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
