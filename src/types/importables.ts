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
    snbt: string;
    leftClickActions?: Action[];
    rightClickActions?: Action[];
};

export type ImportableEvent = {
    type: "EVENT";
    event: Event;
    actions: Action[];
}

export type Importable =
    | ImportableFunction
    | ImportableRegion
    | ImportableMenu
    | ImportableItem
    | ImportableEvent;
