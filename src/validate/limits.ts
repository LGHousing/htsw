import { error } from '../diagnostic';
import { ACTIONS_TO_KWS } from '../helpers';
import type { IrAction, ParseResult } from '../ir';

export function checkLimits(result: ParseResult) {
    for (const holder of result.holders) {
        checkActionLimits(result, holder.actions?.value ?? []);
    }
}

const ACTION_LIMITS: {
    [key in IrAction['type']]: number;
} = {
    FUNCTION: 10,
    CONDITIONAL: 15,
    SET_GROUP: 1,
    KILL: 1,
    HEAL: 5,
    TITLE: 5,
    ACTION_BAR: 5,
    RESET_INVENTORY: 1,
    CHANGE_MAX_HEALTH: 5,
    GIVE_ITEM: 20,
    REMOVE_ITEM: 20,
    MESSAGE: 20,
    APPLY_POTION_EFFECT: 22,
    CLEAR_POTION_EFFECTS: 5,
    GIVE_EXPERIENCE_LEVELS: 5,
    SEND_TO_LOBBY: 1,
    CHANGE_VAR: 25,
    TELEPORT: 5,
    FAIL_PARKOUR: 1,
    PLAY_SOUND: 25,
    SET_COMPASS_TARGET: 5,
    SET_GAMEMODE: 1,
    CHANGE_HEALTH: 5,
    CHANGE_HUNGER: 5,
    RANDOM: 5,
    APPLY_INVENTORY_LAYOUT: 5,
    ENCHANT_HELD_ITEM: 5,
    PAUSE: 30,
    SET_TEAM: 1,
    SET_MENU: 10,
    DROP_ITEM: 5,
    SET_VELOCITY: 5,
    LAUNCH: 5,
    EXIT: 1,
    CANCEL_EVENT: 1,
};

function checkActionLimits(result: ParseResult, actions: IrAction[]) {
    const limits = structuredClone(ACTION_LIMITS);

    for (const action of actions) {
        if (limits[action.type] <= 0) {
            const message = `Limit of ${ACTION_LIMITS[action.type]} ${ACTIONS_TO_KWS[action.type]} actions exceeded`;
            result.diagnostics.push(error(message, action.span));
        }

        limits[action.type] -= 1;
    }

    for (const action of actions) {
        if (action.type === 'CONDITIONAL') {
            checkActionLimits(result, action.ifActions?.value ?? []);
            checkActionLimits(result, action.elseActions?.value ?? []);
        } else if (action.type === 'RANDOM') {
            checkActionLimits(result, action.actions?.value ?? []);
        }
    }
}
