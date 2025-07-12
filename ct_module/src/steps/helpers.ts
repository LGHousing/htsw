import { Step } from './step';
import { getSlotFromName } from '../slots';
import { normalized, assertIsNormalized } from '../utils';

export function booleanAsValue(value: boolean): string {
    return value ? 'Enabled' : 'Disabled';
}

export function numberAsValue(value: number): string {
    return value.toString();
}

export function stringAsValue(value: string): string {
    return value;
}

export function stepsClickButtonThenSelectValue(
    key: string,
    keyIsNormalized: boolean,
    value: string,
    valueIsNormalized: boolean
): Step[] {
    if (keyIsNormalized) {
        assertIsNormalized(key);
    }
    if (valueIsNormalized) {
        assertIsNormalized(value);
    }
    return [
        {
            type: 'CLICK_BUTTON',
            key: key,
            keyIsNormalized: keyIsNormalized,
        },
        {
            type: 'SELECT_VALUE',
            key: key,
            keyIsNormalized: keyIsNormalized,
            value: value,
            valueIsNormalized: valueIsNormalized,
        },
    ];
}

export function stepsAddAction(actionName: string): Step[] {
    assertIsNormalized(actionName);
    return stepsClickButtonThenSelectValue('add_action', true, actionName, true);
}

export function stepGoBack(): Step {
    return {
        type: 'CLICK_BUTTON',
        key: 'go_back',
        keyIsNormalized: true,
    };
}

export function stepClickButtonOrNextPage(name: string, isNormalized: boolean): Step {
    if (isNormalized) {
        assertIsNormalized(name);
    }
    return {
        type: 'CONDITIONAL',
        condition: () => getSlotFromName(name, isNormalized) !== null,
        then: () => [
            {
                type: 'CLICK_BUTTON',
                key: name,
                keyIsNormalized: isNormalized,
            },
        ],
        else: () => [
            {
                type: 'CONDITIONAL',
                condition: () => getSlotFromName('next_page', true) !== null,
                then: () => [
                    {
                        type: 'CLICK_BUTTON',
                        key: 'next_page',
                        keyIsNormalized: true,
                    },
                    stepClickButtonOrNextPage(name, isNormalized),
                ],
                else: () => {
                    throw new Error(`Could not find slot for key: ${name}`);
                },
            },
        ],
    };
}
