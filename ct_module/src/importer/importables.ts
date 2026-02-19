import {
    Importable,
    ImportableEvent,
    ImportableFunction,
    ImportableRegion,
} from "htsw/types";

import { importAction } from "./actions";
import TaskContext from "../tasks/context";
import { clickSlotPaginate, goBack, setValue, waitForMenuToLoad } from "./helpers";
import { MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../helpers";

export async function importImportable(
    ctx: TaskContext,
    importable: Importable
): Promise<void> {
    if (importable.type === "FUNCTION") {
        return importImportableFunction(ctx, importable);
    }
    if (importable.type === "EVENT") {
        return importImportableEvent(ctx, importable);
    }
    if (importable.type === "REGION") {
        return importImportableRegion(ctx, importable);
    }
    // TODO add the others idk and remove the ts ignore
    // @ts-ignore
    const _exhaustiveCheck: never = importable;
}

async function importImportableFunction(
    ctx: TaskContext,
    importable: ImportableFunction
): Promise<void> {
    ctx.runCommand(`/function edit ${importable.name}`);

    const alreadyExists = await ctx.withTimeout(
        Promise.race([
            waitForMenuToLoad(ctx).then(() => true),
            ctx
                .waitFor(
                    "message",
                    (message) =>
                        removedFormatting(message) ===
                        "Could not find a function with that name!"
                )
                .then(() => false),
        ]),
        "Waiting for function to open"
    );

    if (!alreadyExists) {
        ctx.runCommand(`/function create ${importable.name}`);
        await waitForMenuToLoad(ctx);
    }

    // we have a function!!! open!!
    for (const action of importable.actions) {
        await importAction(ctx, action);
    }

    if (importable.repeatTicks) {
        await goBack(ctx);
        await clickSlotPaginate(ctx, importable.name, MouseButton.RIGHT);
        await setValue(ctx, "Automatic Execution", importable.repeatTicks);
    }

    // TODO repeat ticks
}

async function importImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent
): Promise<void> {}

async function importImportableRegion(
    ctx: TaskContext,
    importable: ImportableRegion
): Promise<void> {}
