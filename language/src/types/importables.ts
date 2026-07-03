import type { Tag } from "../nbt";
import type { Action } from "./actions";
import type { Bounds, Color, CommandMode, Event, MenuSlot, Permission, Pos } from "./types";

/**
 * The resolved file an importable's content lives in — the `.htsl` for
 * file-backed actions, the `.snbt` for an item's nbt, otherwise the
 * import.json that declared it. Stamped by the import.json parser; absent
 * on importables built elsewhere (house reads, tests).
 */
type ImportableSource = {
    sourcePath?: string;
};

export type ImportableFunction = ImportableSource & {
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

export type ImportableRegion = ImportableSource & {
    type: "REGION";
    name: string;
    bounds?: Bounds;
    onEnterActions?: Action[];
    onEnterActionsPath?: string;
    onExitActions?: Action[];
    onExitActionsPath?: string;
};

export type ImportableMenu = ImportableSource & {
    type: "MENU";
    name: string;
    size?: number;
    slots: MenuSlot[];
};

export type ImportableItem = ImportableSource & {
    type: "ITEM";
    name: string;
    nbt: Tag;
    leftClickActions?: Action[];
    leftClickActionsPath?: string;
    rightClickActions?: Action[];
    rightClickActionsPath?: string;
};

export type ImportableEvent = ImportableSource & {
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

export type ImportableNpc = ImportableSource & {
    type: "NPC";
    name: string;
    pos: Pos;
    leftClickActions?: Action[];
    leftClickActionsPath?: string;
    rightClickActions?: Action[];
    rightClickActionsPath?: string;
    leftClickRedirect?: boolean;
    lookAtPlayers?: boolean;
    hideNameTag?: boolean;
    skin?: NpcSkin;
    equipment?: NpcEquipment;
};

export type ImportableTeam = ImportableSource & {
    type: "TEAM",
    name: string,
    tag?: string,
    color?: Color,
    friendlyFire?: boolean,
};

export type ImportableGroup = ImportableSource & {
    type: "GROUP",
    name: string,
    tag?: string,
    color?: Color,
    priority?: number,
    permissions?: Record<Permission, boolean>,
};

export type ImportableCommand = ImportableSource & {
    type: "COMMAND",
    name: string,
    actions?: Action[],
    actionsPath?: string,
    mode?: CommandMode,
    requiredPriority?: number,
    listed?: boolean,
}

export type ImportableHouseName = ImportableSource & {
    type: "HOUSE_NAME",
    name: string,
};

export type Importable =
    | ImportableFunction
    | ImportableRegion
    | ImportableMenu
    | ImportableItem
    | ImportableEvent
    | ImportableNpc
    | ImportableTeam
    | ImportableGroup
    | ImportableCommand
    | ImportableHouseName;
