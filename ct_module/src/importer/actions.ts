import * as htsl from "htsl";

import { Step } from "./step";
import {
    stepGoBack,
    stepsAddAction,
    stepsClickButtonThenSelectValue,
    stringAsValue,
} from "./helpers";

export function stepsForAction(action: htsl.Action): Step[] {
    if (action.type === "SET_GROUP") {
        return stepsForActionChangeGroup(action);
    }

    return [];
}

function stepsForActionChangeGroup(action: htsl.ActionSetGroup): Step[] {
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
