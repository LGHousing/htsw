import { Diagnostic, runtime } from "htsw";
import type {
    ActionActionBar,
    ActionFunction,
    ActionPlaySound,
    ActionSendMessage,
    ActionSetVelocity,
    ActionTeleport,
    ActionTitle,
} from "htsw/types";

import { replacePlaceholders } from "./placeholders";
import { coerceWithin } from "./helpers";
import { resolveLocation } from "./locations";
import { getSimulatorImportables } from "./session";
import { getPlayer, showTitle } from "../utils/java";

export function createActionBehaviors(vars: runtime.simple.Vars): runtime.ActionBehaviors {
    return new runtime.simple.SimpleActionBehaviors(vars)
        .with("FUNCTION", behaviorFunction)
        .with("ACTION_BAR", behaviorActionBar)
        .with("MESSAGE", behaviorSendChatMessage)
        .with("PLAY_SOUND", behaviorPlaySound)
        .with("SET_VELOCITY", behaviorSetVelocity)
        .with("TELEPORT", behaviorTeleport)
        .with("TITLE", behaviorTitle);
}

function behaviorFunction(rt: runtime.Runtime, action: ActionFunction) {
    if (!action.function) return;

    for (const importable of getSimulatorImportables()) {
        if (importable.type !== "FUNCTION") continue;
        if (importable.name !== action.function) continue;

        rt.runActions(importable.actions ?? []);
        return;
    }

    const err = Diagnostic.warning(
        `Unknown function '${action.function}'`
    ).addPrimarySpan(rt.spans.getField(action, "function"));

    rt.emitDiagnostic(err);
}

function behaviorActionBar(_rt: runtime.Runtime, action: ActionActionBar) {
    const message = replacePlaceholders(action.message);
    ChatLib.actionBar(message);
}

function behaviorSendChatMessage(_rt: runtime.Runtime, action: ActionSendMessage) {
    const message = replacePlaceholders(action.message);
    ChatLib.chat(`&7*&r ${message}`);
}

function behaviorPlaySound(rt: runtime.Runtime, action: ActionPlaySound) {
    if (action.location?.type === "Invokers Location") {
        getPlayer().func_85030_a /*playSound*/(
            action.sound, action.volume ?? 0.7, action.pitch ?? 1.0
        );
    } else {
        const location = resolveLocation(rt, action.location ?? { "type": "Invokers Location" });

        const pos = new BlockPos(location.x, location.y, location.z);
        (
            World as unknown as {
                getWorld(): {
                    func_175731_a(
                        position: unknown,
                        sound: string,
                        volume: number,
                        pitch: number,
                        distanceDelay: boolean
                    ): void;
                };
            }
        ).getWorld().func_175731_a /*playSoundAtPos*/(
            pos.toMCBlock(),
            action.sound, action.volume ?? 0.7, action.pitch ?? 1.0,
            false // distanceDelay
        );
    }
}

function behaviorTeleport(rt: runtime.Runtime, action: ActionTeleport) {
    const location = resolveLocation(rt, action.location);

    ChatLib.say(`/tp ${location.x} ${location.y} ${location.z}`);

    if (location.yaw !== undefined) {
        getPlayer().field_70177_z /*rotationYaw*/ = location.yaw;
    }
    if (location.pitch !== undefined) {
        getPlayer().field_70125_A /*rotationPitch*/ = location.pitch;
    }
}

function behaviorSetVelocity(rt: runtime.Runtime, action: ActionSetVelocity) {
    function coerce(value: number): number {
        return coerceWithin(value, 0, 50);
    }

    const x = coerce(runtime.parseValue(rt, action.x).toDouble());
    const y = coerce(runtime.parseValue(rt, action.y).toDouble());
    const z = coerce(runtime.parseValue(rt, action.z).toDouble());

    const player = getPlayer();

    player.field_71075_bZ /*capabilities*/.field_75100_b /*isFlying*/ = true;
    player
        .func_71016_p /*sendPlayerAbilities*/
        ();

    player.func_70016_h(/*setVelocity*/ x / 10, y / 10, z / 10);

    player.field_71075_bZ /*capabilities*/.field_75100_b /*isFlying*/ = false;
    player
        .func_71016_p /*sendPlayerAbilities*/
        ();
}

function behaviorTitle(_rt: runtime.Runtime, action: ActionTitle) {
    showTitle(
        replacePlaceholders(action.title),
        replacePlaceholders(action.subtitle ?? ""),
        (action.fadein ?? 1) * 20,
        (action.stay ?? 5) * 20,
        (action.fadeout ?? 1) * 20
    );
}
