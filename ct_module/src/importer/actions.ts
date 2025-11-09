import { Action, ActionSetGroup } from "htsw/types";

import { Step } from "./step";
import {
    stepGoBack,
    stepsAddAction,
    stepsClickButtonThenSelectValue,
    stringAsValue,
} from "./helpers";

export function stepsForAction(action: Action): Step[] {
    if (action.type === "SET_GROUP") {
        return stepsForActionChangeGroup(action);
    }

    return [];
}

function stepsForActionChangeGroup(action: ActionSetGroup): Step[] {
    const steps: Step[] = [];

    steps.push(
        ...stepsAddAction(action.type),
        ...stepsClickButtonThenSelectValue("Group", stringAsValue(action.group)),
    );

    if (action.demotionProtection) {
        steps.push({
            type: "CLICK_BUTTON",
            key: "Demotion Protection"
        });
    }

    steps.push(stepGoBack());

    return steps;
}
