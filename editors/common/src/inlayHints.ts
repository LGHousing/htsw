import * as htsl from 'htsl/src';

type InlayHint = {
    label: string;
    span: htsl.Span;
};

function hint(label: string, span: htsl.Span): InlayHint {
    return { label, span };
}

export function provideInlayHints(src: string): InlayHint[] {
    const actions = htsl.parse.parseFromString(src);

    const hints: InlayHint[] = [];

    for (const holders of actions.holders) {
        hints.push(...provideInlayHintsForActions(holders.actions?.value ?? []));
    }

    return hints;
}

function provideInlayHintsForActions(actions: htsl.IrAction[]): InlayHint[] {
    const hints: InlayHint[] = [];

    for (const action of actions) {
        if (action.type === 'CONDITIONAL') {
            hints.push(...provideInlayHintsForConditions(action.conditions?.value ?? []));

            hints.push(...provideInlayHintsForActions(action.ifActions?.value ?? []));
            hints.push(...provideInlayHintsForActions(action.elseActions?.value ?? []));
        } else if (action.type === 'RANDOM') {
            hints.push(...provideInlayHintsForActions(action.actions?.value ?? []));
        }

        if (
            action.type === 'CHANGE_VAR' ||
            action.type === 'CONDITIONAL' ||
            action.type === 'RANDOM'
        )
            continue; // don't provide hints for these

        for (const key of htsl.irKeys(action)) {
            if (key === 'function') continue; // skip these

            // @ts-ignore
            const element: { value: any; span: htsl.Span } = action[key];

            // this element was skipped on purpose
            if (element.value === null) continue;

            if (element.value === undefined) break;

            hints.push(hint(key, element.span));
        }
    }

    return hints;
}

function provideInlayHintsForConditions(conditions: htsl.IrCondition[]): InlayHint[] {
    const hints: InlayHint[] = [];

    for (const condition of conditions) {
        if (
            condition.type === 'COMPARE_VAR' ||
            condition.type === 'COMPARE_PLACEHOLDER'
        )
            continue; // don't provide hints for these

        for (const key of htsl.irKeys(condition)) {
            if (key === 'inverted') continue; // skip these

            // @ts-ignore
            const element: { value: any; span: htsl.Span } = condition[key];

            // this element was skipped on purpose
            if (element.value === null) continue;

            if (element.value === undefined) break;

            hints.push(hint(key, element.span));
        }
    }

    return hints;
}
