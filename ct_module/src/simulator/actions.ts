import { Diagnostic, runtime, Span } from "htsw";
import type {
    ActionActionBar,
    ActionFunction,
    ActionPlaySound,
    ActionSendMessage,
    ActionSetVelocity,
    ActionTeleport,
    ActionTitle,
} from "htsw/types";

import { Simulator } from "./simulator";
import { replacePlaceholders } from "./placeholders";
import { coerceWithin } from "./helpers";
import { printDiagnostic } from "../tui/diagnostics";

function fieldSpan(action: object, key: string): Span {
    return Simulator.getFieldSpan(action, key)
        ?? Simulator.getNodeSpan(action)
        ?? Span.dummy();
}

export function createActionBehaviors(): runtime.ActionBehaviors {
    return runtime.ActionBehaviors.default()
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

    for (const importable of Simulator.importables) {
        if (importable.type !== "FUNCTION") continue;
        if (importable.name !== action.function) continue;

        rt.runActions(importable.actions ?? []);
        return;
    }

    rt.addDiagnostic(
        Diagnostic.warning(`Unknown function '${action.function}'`),
        action,
        "function",
    );
}

function behaviorActionBar(_rt: runtime.Runtime, action: ActionActionBar) {
    const message = replacePlaceholders(action.message);
    ChatLib.actionBar(message);
}

function behaviorSendChatMessage(_rt: runtime.Runtime, action: ActionSendMessage) {
    const message = replacePlaceholders(action.message);
    ChatLib.chat(`&7*&r ${message}`);
}

function behaviorPlaySound(_rt: runtime.Runtime, _action: ActionPlaySound) {

}

function behaviorTeleport(_rt: runtime.Runtime, action: ActionTeleport) {
    if (action.location.type === "Invokers Location") {
        ChatLib.say("/tp ~ ~ ~");
    } else if (action.location.type === "Custom Coordinates") {
        ChatLib.say(`/tp ${replacePlaceholders(action.location.value ?? "")}`);
    } else {
        const warn = Diagnostic
            .warning("House spawn cannot be used in Simulator mode")
            .addPrimarySpan(fieldSpan(action as object, "location"));

        printDiagnostic(Simulator.sm, warn);
    }
}

function behaviorSetVelocity(rt: runtime.Runtime, action: ActionSetVelocity) {
    function coerce(value: number): number {
        return coerceWithin(value, 0, 50);
    }

    const x = coerce(runtime.parseValue(rt, action.x).toDouble());
    const y = coerce(runtime.parseValue(rt, action.y).toDouble());
    const z = coerce(runtime.parseValue(rt, action.z).toDouble());

    const player = Player.getPlayer();

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
    Client.showTitle(
        replacePlaceholders(action.title),
        replacePlaceholders(action.subtitle ?? ""),
        (action.fadein ?? 1) * 20,
        (action.stay ?? 5) * 20,
        (action.fadeout ?? 1) * 20
    );
}
