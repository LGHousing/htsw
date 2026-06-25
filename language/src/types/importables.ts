import type { Tag } from "../nbt";
import type { Action } from "./actions";
import type { Bounds, Color, CommandMode, Event, MenuSlot, Permission } from "./types";

export type ImportableFunction = {
    type: "FUNCTION";
    name: string;
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

export type ImportableTeam = {
    type: "TEAM",
    name: string,
    tag?: string,
    color?: Color,
    friendlyFire?: boolean,
};

export type ImportableGroup = {
    type: "GROUP",
    name: string,
    tag?: string,
    color?: Color,
    priority?: number,
    permissions?: Record<Permission, boolean>,
};

export type ImportableCommand = {
    type: "COMMAND",
    name: string,
    mode?: CommandMode,
    requiredPriority?: number,
    listed?: boolean,
}

export type ImportableHouseName = {
    type: "HOUSE_NAME",
    name: string,
};

export type Importable =
    | ImportableFunction
    | ImportableRegion
    | ImportableMenu
    | ImportableItem
    | ImportableEvent
    | ImportableTeam
    | ImportableGroup
    | ImportableCommand
    | ImportableHouseName;
