import { Diagnostic, htsl } from "htsw";
import type { Ir, IrAction } from "htsw/ir";
import type { ActionActionBar, ActionChangeVar, ActionConditional, ActionFunction, ActionSendMessage, ActionPauseExecution, ActionPlaySound, ActionRandom, ActionSetVelocity, ActionTeleport, ActionTitle } from "htsw/types";

import { ExitError, PauseError, Simulator } from "./simulator";
import { VarHolder, VarLong, parseValue } from "./vars";
import { replacePlaceholders } from "./placeholders";
import { runCondition } from "./conditions";
import { coerceWithin } from "./helpers";
import { printDiagnostic } from "../tui/diagnostics";

export function runAction(action: IrAction) {
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
        runActionMessage(action);
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

function runActionActionBar(action: Ir<ActionActionBar>) {
    if (!action.message) return;

    const message = replacePlaceholders(action.message.value);
    ChatLib.actionBar(message);
}

function runActionChangeVar(action: Ir<ActionChangeVar>) {
    if (!action.holder || !action.op || !action.key) return;

    const holderType = action.holder.value.type;

    const varKey =
        holderType === "team"
            ? { team: action.holder.value.team, key: action.key.value }
            : action.key.value;

    const varHolder: VarHolder<any> =
        holderType === "team"
            ? Simulator.teamVars
            : holderType === "global"
                ? Simulator.globalVars
                : Simulator.playerVars;

    if (action.op.value === "Unset") {
        varHolder.unsetVar(varKey);
        return;
    }

    if (!action.value) return;

    const rhs = parseValue(action.value.value);
    const lhs = varHolder.getVar(varKey, rhs.unsetValue());
    
    if (action.op.value === "Set") {
        varHolder.setVar(varKey, rhs);
        return;
    }

    const opStr = htsl.helpers.OPERATION_SYMBOLS[action.op.value];
    
    const lhsType = varHolder.hasVar(varKey) ? "unknown" : lhs.type;

    const err = Diagnostic
        .error(`Operator ${opStr} cannot be applied to types ${lhsType} and ${rhs.type}`)
        .addPrimarySpan(action.op.span)
        .addSecondarySpan(action.key.span, `Value is ${lhs.toDisplayString()}`);

    if (lhs.type !== rhs.type || lhs.type === "string" || rhs.type === "string") {
        throw err;
    }

    let result;
    try {
        result = lhs.binOp(rhs, action.op.value);
    } catch (e) {
        throw err;
    }

    varHolder.setVar(varKey, result);
}

function runActionConditional(action: Ir<ActionConditional>) {
    if (!action.matchAny || !action.conditions || !action.ifActions) return;

    const matchAny = action.matchAny.value;

    let matches = 0;
    for (const condition of action.conditions.value) {
        if (runCondition(condition)) matches++;
    }

    if (
        (matchAny && matches > 0) ||
        (!matchAny && matches === action.conditions.value.length)
    ) {
        Simulator.runActions(action.ifActions.value, true);
    } else if (action.elseActions) {
        Simulator.runActions(action.elseActions.value, true);
    }
}

function runActionFunction(action: Ir<ActionFunction>) {
    if (!action.function) return;

    const result = Simulator.runFunction(action.function.value);

    if (!result) {
        const warn = Diagnostic.warning("Unknown function called")
            .addPrimarySpan(action.function.span);

        printDiagnostic(Simulator.sm, warn);
    }
}

function runActionMessage(action: Ir<ActionSendMessage>) {
    if (!action.message) return;

    const message = replacePlaceholders(action.message.value);
    ChatLib.chat(`&7*&r ${message}`);
}

function runActionPauseExecution(action: Ir<ActionPauseExecution>) {
    if (!action.ticks) return;

    throw new PauseError(action.ticks.value);
}

function runActionPlaySound(action: Ir<ActionPlaySound>) {

}

function runActionTeleport(action: Ir<ActionTeleport>) {
    if (!action.location) return;

    if (action.location.value.type === "Invokers Location") {
        ChatLib.say("/tp ~ ~ ~");
    } else if (action.location.value.type === "Custom Coordinates") {
        ChatLib.say(`/tp ${replacePlaceholders(action.location.value.value?.value ?? "")}`);
    } else {
        const warn = Diagnostic
            .warning("House spawn cannot be used in Simulator mode")
            .addPrimarySpan(action.location.span);

        printDiagnostic(Simulator.sm, warn);
    }
}

function runActionRandom(action: Ir<ActionRandom>) {
    if (!action.actions) return;

    const randIdx = Math.floor(Math.random() * action.actions.value.length);

    runAction(action.actions.value[randIdx]);
}

function runActionSetVelocity(action: Ir<ActionSetVelocity>) {
    if (!action.x || !action.y || !action.z) return;

    function coerce(value: number): number {
        return coerceWithin(value, 0, 50);
    }

    const x = coerce(parseValue(action.x.value).toDouble());
    const y = coerce(parseValue(action.y.value).toDouble());
    const z = coerce(parseValue(action.z.value).toDouble());

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

function runActionTitle(action: Ir<ActionTitle>) {
    if (!action.title) return;

    Client.showTitle(
        replacePlaceholders(action.title.value),
        replacePlaceholders(action.subtitle?.value ?? ""),
        (action.fadein?.value ?? 1) * 20,
        (action.stay?.value ?? 5) * 20,
        (action.fadeout?.value ?? 1) * 20
    );
}
