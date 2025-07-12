import { error } from '../diagnostic';
import type { IrAction, ParseResult } from '../ir';

export function checkNesting(result: ParseResult) {
    for (const holder of result.holders) {
        for (const action of holder.actions?.value ?? []) {
            if (action.type === 'CONDITIONAL') {
                checkActionNesting(result, 'CONDITIONAL', action.ifActions?.value ?? []);
                checkActionNesting(result, 'CONDITIONAL', action.elseActions?.value ?? []);
            } else if (action.type === 'RANDOM') {
                checkActionNesting(result, 'RANDOM', action.actions?.value ?? []);
            }
        }
    }
}

const CONTEXT_NAMES: {
    [context in IrAction['type']]?: string;
} = {
    CONDITIONAL: 'conditional',
    RANDOM: 'random action',
};

function checkActionNesting(
    result: ParseResult,
    context: IrAction['type'],
    actions: IrAction[]
) {
    const name = CONTEXT_NAMES[context]!;

    for (const action of actions) {
        if (action.type === 'CONDITIONAL' || action.type === 'RANDOM') {
            const message = `Cannot use a ${CONTEXT_NAMES[action.type]} inside of a ${name}`;
            result.diagnostics.push(error(message, action.kwSpan));
        }

        // to catch deeply nested actions, in case they have them for whatever reason.
        if (action.type === 'CONDITIONAL') {
            checkActionNesting(result, 'CONDITIONAL', action.ifActions?.value ?? []);
            checkActionNesting(result, 'CONDITIONAL', action.elseActions?.value ?? []);
        } else if (action.type === 'RANDOM') {
            checkActionNesting(result, 'RANDOM', action.actions?.value ?? []);
        }
    }
}
