import { Importable, ImportableFunction } from "htsw/types";

import { Step } from "./step";
import { chatHistoryContains } from "../helpers";
import { Importer } from "./importer";
import { stepsForAction } from "./actions";

export function stepsForImportable(importable: Importable): Step[] {
    if (importable.type === "FUNCTION") {
        return stepsforImportableFunction(importable);
    }
    return [];
}

function stepsforImportableFunction(
    importable: ImportableFunction
): Step[] {
    const steps: Step[] = [];

    steps.push({
        type: "RUN_COMMAND",
        command: `/function edit ${importable.name}`,
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
                command: `/function create ${importable.name}`,
            },
        ],
        else: () => [],
    });

    for (const action of importable.actions) {
        steps.push(...stepsForAction(action));
    }

    return steps;
}