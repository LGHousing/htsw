import * as htsl from "htsl";
import type { AABB, MenuSlot } from "./types";

export type ImportableFunction = {
    type: "function";
    name: string;
    actions: htsl.Action[];
    repeatTicks?: number;
};

export type ImportableRegion = {
    type: "region";
    name: string;
    bounds: AABB;
    onEnterActions?: htsl.Action[];
    onExitActions?: htsl.Action[];
};

export type ImportableMenu = {
    type: "menu";
    name: string;
    slots: MenuSlot[];
};

export type ImportableItem = {
    type: "item";
    snbt: string;
    leftClickActions?: htsl.Action[];
    rightClickActions?: htsl.Action[];
};

export type Importable =
    | ImportableFunction
    | ImportableRegion
    | ImportableMenu
    | ImportableItem;
