import { error } from '../diagnostic';
import type { IrAction, IrActionHolder, IrCondition, ParseResult } from '../ir';

export function checkContext(result: ParseResult) {
    for (const holder of result.holders) {
        checkHolderContext(result, holder);
    }
}

function checkHolderContext(result: ParseResult, holder: IrActionHolder) {
    if (!holder.actions) return;

    checkExitActions(result, holder.actions.value); // check for exit actions used outside conditionals

    if (holder.type === 'UNKNOWN') return; // don't check more rigorously

    checkActionContext(result, holder, holder.actions.value);

    for (const action of holder.actions.value) {
        if (action.type === 'CONDITIONAL') {
            checkConditionalContext(result, holder, action.conditions?.value ?? []);
        }
    }
}

function checkActionContext(
    result: ParseResult,
    holder: IrActionHolder,
    actions: IrAction[]
) {
    for (const action of actions) {
        if (action.type === 'CONDITIONAL') {
            checkActionContext(result, holder, action.ifActions?.value ?? []);
            checkActionContext(result, holder, action.elseActions?.value ?? []);
        } else if (action.type === 'RANDOM') {
            checkActionContext(result, holder, action.actions?.value ?? []);
        }
        if (action.type === 'CANCEL_EVENT') {
            if (holder.type !== 'EVENT') {
                // TODO check for events that can't be cancelled
                result.diagnostics.push(
                    error(
                        'Cancel Event action can only be used in event actions',
                        action.kwSpan
                    )
                );
            }
        }
    }
}

function checkConditionalContext(
    result: ParseResult,
    holder: IrActionHolder,
    conditions: IrCondition[]
) {
    for (const condition of conditions) {
        if (condition.type === 'COMPARE_DAMAGE') {
            if (!(holder.type === 'EVENT' && holder.event?.value === 'Player Damage')) {
                result.diagnostics.push(
                    error(
                        'Damage Amount condition can only be used in the Player Damage event',
                        condition.kwSpan
                    )
                );
            }
        }
    }
}

function checkExitActions(result: ParseResult, actions: IrAction[]) {
    for (const action of actions) {
        if (action.type === 'EXIT') {
            result.diagnostics.push(
                error('Exit action can only be used in conditionals', action.kwSpan)
            );
        }

        // ensure no exits are in a random action
        if (action.type === 'RANDOM') {
            checkExitActions(result, action.actions?.value ?? []);
        }
    }
}
