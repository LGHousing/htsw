import { Event } from "htsw/types";
import { getSimulatorImportables, runSimulatorActions } from "./session";

export function registerEventTriggers(): Trigger[] {
    runEvent("Player Join");

    return [register("tick", tick)];
}

class EventState {
    static isFlying: boolean = false;
    static isSneaking: boolean = false;
}

function runEvent(event: Event) {
    for (const importable of getSimulatorImportables()) {
        if (importable.type === "EVENT" && importable.event === event) {
            runSimulatorActions(importable.actions ?? []);
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
