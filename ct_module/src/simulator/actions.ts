import { Diagnostic, htsl, Span } from "htsw";
import type {
    Action,
    ActionActionBar,
    ActionChangeVar,
    ActionConditional,
    ActionFunction,
    ActionPauseExecution,
    ActionPlaySound,
    ActionRandom,
    ActionSendMessage,
    ActionSetVelocity,
    ActionTeleport,
    ActionTitle,
} from "htsw/types";

import { ExitError, PauseError, Simulator } from "./simulator";
import { VarHolder, parseValue } from "./vars";
import { replacePlaceholders } from "./placeholders";
import { runCondition } from "./conditions";
import { coerceWithin } from "./helpers";
import { printDiagnostic } from "../tui/diagnostics";

function fieldSpan(action: object, key: string): Span {
    return Simulator.getFieldSpan(action, key)
        ?? Simulator.getNodeSpan(action)
        ?? Span.dummy();
}

export function runAction(action: Action) {
    if (action.type === "ACTION_BAR") {
        runActionActionBar(action);
    } else if (action.type === "CHANGE_VAR") {
        runActionChangeVar(action);
    } else if (action.type === "CONDITIONAL") {
        runActionConditional(action);
    } else if (action.type === "EXIT") {
        throw new ExitError();
    } else if (action.type === "FUNCTION") {
        runActionFunction(action);
    } else if (action.type === "MESSAGE") {
        runActionSendChatMessage(action);
    } else if (action.type === "PAUSE") {
        runActionPauseExecution(action);
    } else if (action.type === "PLAY_SOUND") {

    } else if (action.type === "RANDOM") {
        runActionRandom(action);
    } else if (action.type === "SET_VELOCITY") {
        runActionSetVelocity(action);
    } else if (action.type === "TELEPORT") {
        runActionTeleport(action);
    } else if (action.type === "TITLE") {
        runActionTitle(action);
    }
}

function runActionActionBar(action: ActionActionBar) {
    if (!action.message) return;

    const message = replacePlaceholders(action.message);
    ChatLib.actionBar(message);
}

function runActionChangeVar(action: ActionChangeVar) {
    if (!action.holder || !action.op || !action.key) return;

    const holderType = action.holder.type;

    const varKey =
        holderType === "team"
            ? { team: action.holder.team, key: action.key }
            : action.key;

    const varHolder: VarHolder<any> =
        holderType === "team"
            ? Simulator.teamVars
            : holderType === "global"
                ? Simulator.globalVars
                : Simulator.playerVars;

    if (action.op === "Unset") {
        varHolder.unsetVar(varKey);
        return;
    }

    if (!action.value) return;

    const rhs = parseValue(action.value);
    const lhs = varHolder.getVar(varKey, rhs.unsetValue());
    
    if (action.op === "Set") {
        varHolder.setVar(varKey, rhs);
        return;
    }

    const opStr = htsl.helpers.OPERATION_SYMBOLS[action.op];
    const lhsType = varHolder.hasVar(varKey) ? "unknown" : lhs.type;

    const err = Diagnostic
        .error(`Operator ${opStr} cannot be applied to types ${lhsType} and ${rhs.type}`)
        .addPrimarySpan(fieldSpan(action as object, "op"))
        .addSecondarySpan(fieldSpan(action as object, "key"), `Value is ${lhs.toDisplayString()}`);

    if (lhs.type !== rhs.type || lhs.type === "string" || rhs.type === "string") {
        throw err;
    }

    let result;
    try {
        result = lhs.binOp(rhs, action.op);
    } catch (_e) {
        throw err;
    }

    varHolder.setVar(varKey, result);
}

function runActionConditional(action: ActionConditional) {
    if (action.matchAny === undefined || !action.conditions || !action.ifActions) return;

    let matches = 0;
    for (const condition of action.conditions) {
        if (runCondition(condition)) matches++;
    }

    if (
        (action.matchAny && matches > 0) ||
        (!action.matchAny && matches === action.conditions.length)
    ) {
        Simulator.runActions(action.ifActions, true);
    } else if (action.elseActions) {
        Simulator.runActions(action.elseActions, true);
    }
}

function runActionFunction(action: ActionFunction) {
    if (!action.function) return;

    const result = Simulator.runFunction(action.function);

    if (!result) {
        const warn = Diagnostic.warning("Unknown function called")
            .addPrimarySpan(fieldSpan(action as object, "function"));

        printDiagnostic(Simulator.sm, warn);
    }
}

function runActionSendChatMessage(action: ActionSendMessage) {
    if (!action.message) return;

    const message = replacePlaceholders(action.message);
    ChatLib.chat(`&7*&r ${message}`);
}

function runActionPauseExecution(action: ActionPauseExecution) {
    if (action.ticks === undefined) return;

    throw new PauseError(action.ticks);
}

function runActionPlaySound(_action: ActionPlaySound) {

}

function runActionTeleport(action: ActionTeleport) {
    if (!action.location) return;

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

function runActionRandom(action: ActionRandom) {
    if (!action.actions || action.actions.length === 0) return;

    const randIdx = Math.floor(Math.random() * action.actions.length);

    runAction(action.actions[randIdx]);
}

function runActionSetVelocity(action: ActionSetVelocity) {
    if (action.x === undefined || action.y === undefined || action.z === undefined) return;

    function coerce(value: number): number {
        return coerceWithin(value, 0, 50);
    }

    const x = coerce(parseValue(action.x).toDouble());
    const y = coerce(parseValue(action.y).toDouble());
    const z = coerce(parseValue(action.z).toDouble());

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

function runActionTitle(action: ActionTitle) {
    if (!action.title) return;

    Client.showTitle(
        replacePlaceholders(action.title),
        replacePlaceholders(action.subtitle ?? ""),
        (action.fadein ?? 1) * 20,
        (action.stay ?? 5) * 20,
        (action.fadeout ?? 1) * 20
    );
}
