import { ACTION_NAMES, Action } from "htsw/types";

import { Step } from "./step";
import { getSlotFromName } from "../slots";

export function booleanAsValue(value: boolean): string {
    return value ? "Enabled" : "Disabled";
}

export function numberAsValue(value: number): string {
    return value.toString();
}

export function stringAsValue(value: string): string {
    return value;
}

export function stepsClickButtonThenSelectValue(key: string, value: string): Step[] {
    return [
        {
            type: "CLICK_BUTTON",
            key: key,
        },
        {
            type: "SELECT_VALUE",
            key: key,
            value: value,
        },
    ];
}

export function stepsAddAction(type: Action["type"]): Step[] {
    const name = ACTION_NAMES[type];
    return stepsClickButtonThenSelectValue("Add Action", name);
}

export function stepGoBack(): Step {
    return {
        type: "CLICK_BUTTON",
        key: "Go Back",
    };
}

export function stepClickButtonOrNextPage(name: string): Step {
    return {
        type: "CONDITIONAL",
        condition: () => getSlotFromName(name) !== null,
        then: () => [
            {
                type: "CLICK_BUTTON",
                key: name,
            },
        ],
        else: () => [
            {
                type: "CONDITIONAL",
                condition: () => getSlotFromName("Next Page") !== null,
                then: () => [
                    {
                        type: "CLICK_BUTTON",
                        key: "next_page",
                        keyIsNormalized: true,
                    },
                    stepClickButtonOrNextPage(name),
                ],
                else: () => {
                    throw new Error(`Could not find slot for key: ${name}`);
                },
            },
        ],
    };
}
