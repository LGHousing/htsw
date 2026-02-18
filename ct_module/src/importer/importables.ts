import { Importable, ImportableEvent, ImportableFunction, ImportableRegion } from "htsw/types";

import { Step } from "./step";
import { Importer } from "./importer";
import { stepsForAction } from "./actions";
import { stepSelectValue } from "./stepHelpers";

export function stepsForImportable(importable: Importable): Step[] {
    if (importable.type === "FUNCTION") {
        return stepsforImportableFunction(importable);
    }
    if (importable.type === "EVENT") {
        return stepsForImportableEvent(importable);
    }
    if (importable.type === "REGION") {
        return stepsForImportableRegion(importable);
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
            // lol
            // return chatHistoryContains(
            //     "Could not find a function with that name!",
            //     Importer.lastStepExecutedAt,
            //     false,
            //     false
            // );
            return false;
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

function stepsForImportableEvent(
    importable: ImportableEvent
): Step[] {
    const steps: Step[] = [];

    steps.push({
        type: "RUN_COMMAND",
        command: "/eventactions",
    });

    steps.push(stepSelectValue(importable.event));

    for (const action of importable.actions) {
        steps.push(...stepsForAction(action));
    }

    return steps;
}

function stepsForImportableRegion(
    importable: ImportableRegion
): Step[] {
    const steps: Step[] = [];

    steps.push({
        type: "RUN_COMMAND",
        command: `/region edit ${importable.name}`,
    });

    if (importable.onEnterActions && importable.onEnterActions.length > 0) {
        steps.push(stepSelectValue("Entry Actions"));
        for (const action of importable.onEnterActions) {
            steps.push(...stepsForAction(action));
        }
        steps.push({
            type: "CLICK_BUTTON",
            key: "Go Back",
        });
    }

    if (importable.onExitActions && importable.onExitActions.length > 0) {
        steps.push(stepSelectValue("Exit Actions"));
        for (const action of importable.onExitActions) {
            steps.push(...stepsForAction(action));
        }
    }

    return steps;
}
