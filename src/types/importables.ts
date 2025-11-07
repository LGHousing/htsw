import type { Action } from "./actions";
import type { AABB, MenuSlot } from "./types";

export type ImportableFunction = {
    type: "function";
    name: string;
    actions: Action[];
    repeatTicks?: number;
};

export type ImportableRegion = {
    type: "region";
    name: string;
    bounds: AABB;
    onEnterActions?: Action[];
    onExitActions?: Action[];
};

export type ImportableMenu = {
    type: "menu";
    name: string;
    slots: MenuSlot[];
};

export type ImportableItem = {
    type: "item";
    snbt: string;
    leftClickActions?: Action[];
    rightClickActions?: Action[];
};

export type Importable =
    | ImportableFunction
    | ImportableRegion
    | ImportableMenu
    | ImportableItem;
