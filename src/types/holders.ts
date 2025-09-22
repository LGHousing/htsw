import { type Action } from "./actions";
import type { Event } from "./types";

export type ActionHolderUnknown = {
    type: "UNKNOWN";
    actions: Action[];
};

export type ActionHolderFunction = {
    type: "FUNCTION";
    name: string;
    actions: Action[];
    repeatTicks?: number;
};

export type ActionHolderEvent = {
    type: "EVENT";
    event: Event;
    actions: Action[];
};

export type ActionHolder = ActionHolderUnknown | ActionHolderFunction | ActionHolderEvent;
