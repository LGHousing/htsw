import * as htsl from "htsl";

import { ExitError, PauseError, Simulator } from "./simulator";
import { VarHolder, parseValue } from "./vars";
import { replacePlaceholders } from "./placeholders";
import { runCondition } from "./conditions";
import { printDiagnostic } from "../compiler/diagnostics";
import { coerceWithin } from "./helpers";

export function runAction(action: htsl.IrAction) {
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

function runActionActionBar(action: htsl.Ir<htsl.ActionActionBar>) {
    if (!action.message) return;

    const message = replacePlaceholders(action.message.value);
    ChatLib.actionBar(message);
}

function runActionChangeVar(action: htsl.Ir<htsl.ActionChangeVar>) {
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

    if (action.op.value === "unset") {
        varHolder.unsetVar(varKey);
        return;
    }

    if (!action.value) return;

    const lhs = varHolder.getVar(varKey);
    const rhs = parseValue(action.value.value);

    if (action.op.value === "set") {
        varHolder.setVar(varKey, rhs);
        return;
    }

    const opStr = htsl.helpers.OPERATION_SYMBOLS[action.op.value];

    const err = htsl.error(
        `Operator ${opStr} cannot be applied to types ${lhs.value === "" ? "unknown" : lhs.type} and ${rhs.type}`,
        action.op.span
    );

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

function runActionConditional(action: htsl.Ir<htsl.ActionConditional>) {
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

function runActionFunction(action: htsl.Ir<htsl.ActionFunction>) {
    if (!action.function) return;

    const result = Simulator.runFunction(action.function.value);

    if (!result) {
        const warn = htsl.warn("Unknown function called", action.function.span);
        printDiagnostic(Simulator.sm, warn);
    }
}

function runActionMessage(action: htsl.Ir<htsl.ActionMessage>) {
    if (!action.message) return;

    const message = replacePlaceholders(action.message.value);
    ChatLib.chat(`&7*&r ${message}`);
}

function runActionPauseExecution(action: htsl.Ir<htsl.ActionPauseExecution>) {
    if (!action.ticks) return;

    throw new PauseError(action.ticks.value);
}

function runActionPlaySound(action: htsl.Ir<htsl.ActionPlaySound>) {

}

function runActionTeleport(action: htsl.Ir<htsl.ActionTeleport>) {
    if (!action.location) return;

    if (action.location.value.type === "location_invokers") {
        ChatLib.say("/tp ~ ~ ~");
    } else if (action.location.value.type === "location_custom") {
        ChatLib.say(`/tp ${replacePlaceholders(action.location.value.value)}`);
    } else {
        const warn = htsl.warn(
            "House spawn cannot be used in Simulator mode",
            action.location.span
        );
        printDiagnostic(Simulator.sm, warn);
    }
}

function runActionRandom(action: htsl.Ir<htsl.ActionRandom>) {
    if (!action.actions) return;

    const randIdx = Math.floor(Math.random() * action.actions.value.length);

    runAction(action.actions.value[randIdx]);
}

function runActionSetVelocity(action: htsl.Ir<htsl.ActionSetVelocity>) {
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

function runActionTitle(action: htsl.Ir<htsl.ActionTitle>) {
    if (!action.title) return;

    Client.showTitle(
        replacePlaceholders(action.title.value),
        replacePlaceholders(action.subtitle?.value ?? ""),
        (action.fadein?.value ?? 1) * 20,
        (action.stay?.value ?? 5) * 20,
        (action.fadeout?.value ?? 1) * 20
    );
}
