import * as htsl from "htsl";
import { Step } from "./step";
import { chatHistoryContains } from "../helpers";
import { Importer } from "./importer";
import { stepsForAction } from "./actions";

export function stepsForHolder(holder: htsl.ActionHolder): Step[] {
    if (holder.type === "FUNCTION") {
        return stepsForHolderFunction(holder);
    }
    return [];
}

function stepsForHolderFunction(
    holder: htsl.ActionHolderFunction
): Step[] {
    const steps: Step[] = [];

    steps.push({
        type: "RUN_COMMAND",
        command: `/function edit ${holder.name}`,
    }, {
        type: "CONDITIONAL",
        condition: () => {
            return chatHistoryContains(
                "Could not find a function with that name!",
                Importer.lastStepExecutedAt,
                false,
                false
            );
        },
        then: () => [
            {
                type: "RUN_COMMAND",
                command: `/function create ${holder.name}`,
            },
        ],
        else: () => [],
    });

    for (const action of holder.actions) {
        steps.push(...stepsForAction(action));
    }

    return steps;
}