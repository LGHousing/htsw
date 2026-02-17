import { Event } from "htsw/types";
import { Simulator } from "./simulator";

export function registerEventTriggers(): Trigger[] {
    runEvent("Player Join");
    
    return [
        register("tick", tick),
    ];
}

class EventState {
    static isFlying: boolean = false;
    static isSneaking: boolean = false;
}

function runEvent(event: Event) {
    for (const importable of Simulator.importables) {
        if (importable.type === "EVENT" && importable.event?.value === event) {
            Simulator.runActions(importable.actions?.value ?? []);
        }
    }
}

function tick() {
    if (EventState.isSneaking !== Player.isSneaking()) {
        runEvent("Player Toggle Sneak");
        EventState.isSneaking = !EventState.isSneaking;
    }
    
    if (EventState.isFlying !== Player.isFlying()) {
        runEvent("Player Toggle Flight");
        EventState.isFlying = !EventState.isFlying;
    }
}