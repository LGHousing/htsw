import type { IrAction, ParseResult } from '../ir';
import { warn } from '../diagnostic';

type Cooldowns = {
    [key: string]: { global: boolean };
};

export function checkCooldowns(result: ParseResult) {
    for (const holder of result.holders) {
        checkCooldownsForActions(result, holder.actions?.value ?? [], {});
    }
}

function checkCooldownsForActions(
    result: ParseResult,
    actions: IrAction[],
    cooldowns: Cooldowns
) {
    for (const action of actions) {
        if (action.type === 'CONDITIONAL') {
            checkCooldownsForActions(result, action.ifActions?.value ?? [], {
                ...cooldowns,
            });
            checkCooldownsForActions(result, action.elseActions?.value ?? [], {
                ...cooldowns,
            });
        } else if (action.type === 'RANDOM') {
            for (const subAction of action.actions?.value ?? []) {
                checkCooldownsForActions(result, [subAction], { ...cooldowns });
            }
        } else if (action.type === 'FUNCTION') {
            if (!action.function) continue;

            const name = action.function.value;

            if (
                name in cooldowns && // function is on cooldown
                // and this one is not global while the previous one was not
                !(!cooldowns[name].global && (action.global?.value ?? true))
            ) {
                result.diagnostics.push(warn('Function will never run', action.span));
            } else {
                cooldowns[name] = {
                    global: action.global?.value ?? false,
                };
            }
        }

        if (doesActionPause(action)) {
            cooldowns = {};
        }
    }
}

function doesActionPause(action: IrAction): boolean {
    if (action.type === 'PAUSE') return true;

    if (action.type === 'RANDOM') {
        for (const subAction of action.actions?.value ?? []) {
            if (subAction.type === 'PAUSE') return true;
        }
        return false;
    }

    // we count the highest initial pause amount in the ifActions or elseActions
    if (action.type === 'CONDITIONAL') {
        for (const ifAction of action.ifActions?.value ?? []) {
            if (ifAction.type === 'PAUSE') return true;
        }
        for (const elseAction of action.elseActions?.value ?? []) {
            if (elseAction.type === 'PAUSE') return true;
        }
        return false;
    }

    return false;
}
