import { Importable, ImportableEvent, ImportableFunction, ImportableRegion } from "htsw/types";

import { Step } from "./step";
import { Importer } from "./importer";
import { importAction } from "./actions";
import { stepSelectValue } from "./stepHelpers";
import TaskContext from "../tasks/context";

export async function importImportable(ctx: TaskContext, importable: Importable): Promise<void> {
    if (importable.type === "FUNCTION") {
        return importImportableFunction(ctx, importable);
    }
    if (importable.type === "EVENT") {
        return importImportableEvent(ctx, importable);
    }
    if (importable.type === "REGION") {
        return importImportableRegion(ctx, importable);
    }
    return [];
}

async function importImportableFunction(ctx: TaskContext, 
    importable: ImportableFunction
): Promise<void> {
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
        steps.push(...importAction(action));
    }

    return steps;
}

async function importImportableEvent(ctx: TaskContext, 
    importable: ImportableEvent
): Promise<void> {
    const steps: Step[] = [];

    steps.push({
        type: "RUN_COMMAND",
        command: "/eventactions",
    });

    steps.push(stepSelectValue(importable.event));

    for (const action of importable.actions) {
        steps.push(...importAction(action));
    }

    return steps;
}

async function importImportableRegion(ctx: TaskContext, 
    importable: ImportableRegion
): Promise<void> {
    const steps: Step[] = [];

    steps.push({
        type: "RUN_COMMAND",
        command: `/region edit ${importable.name}`,
    });

    if (importable.onEnterActions && importable.onEnterActions.length > 0) {
        steps.push(stepSelectValue("Entry Actions"));
        for (const action of importable.onEnterActions) {
            steps.push(...importAction(action));
        }
        steps.push({
            type: "CLICK_BUTTON",
            key: "Go Back",
        });
    }

    if (importable.onExitActions && importable.onExitActions.length > 0) {
        steps.push(stepSelectValue("Exit Actions"));
        for (const action of importable.onExitActions) {
            steps.push(...importAction(action));
        }
    }

    return steps;
}
