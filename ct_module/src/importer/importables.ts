import {
    Importable,
    ImportableEvent,
    ImportableFunction,
    ImportableRegion,
    Pos,
} from "htsw/types";

import { importAction } from "./actions";
import TaskContext from "../tasks/context";
import {
    getSlotPaginate,
    clickGoBack,
    waitForMenuToLoad,
    waitForUnformattedMessage,
    setNumberValue,
} from "./helpers";
import { MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../helpers";
import { onFunctionImported } from "../exporter";

type ImportImportableOptions = {
    importJsonPath?: string;
};

export async function importImportable(
    ctx: TaskContext,
    importable: Importable,
    options?: ImportImportableOptions,
): Promise<void> {
    if (importable.type === "FUNCTION") {
        return importImportableFunction(ctx, importable, options);
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
    importable: ImportableFunction,
    options?: ImportImportableOptions,
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
                        "Could not find a function with that name!",
                )
                .then(() => false),
        ]),
        "Waiting for function to open",
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
        clickGoBack(ctx);
        await waitForMenuToLoad(ctx);

        (await getSlotPaginate(ctx, importable.name)).click(MouseButton.RIGHT);
        await waitForMenuToLoad(ctx);

        await setNumberValue(
            ctx,
            ctx.getItemSlot("Automatic Execution"),
            importable.repeatTicks,
        );
        await waitForMenuToLoad(ctx);
    }

    if (options?.importJsonPath) {
        const warnings = await onFunctionImported(
            ctx,
            options.importJsonPath,
            importable,
        );
        for (const warning of warnings) {
            ctx.displayMessage(`&e${warning}`);
        }
    }
}

async function importImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent,
): Promise<void> {
    ctx.runCommand(`/eventactions`);
    await waitForMenuToLoad(ctx);

    ctx.getItemSlot(importable.event).click();
    await waitForMenuToLoad(ctx);

    // we have an event!!! open!!! :)
    for (const action of importable.actions) {
        await importAction(ctx, action);
    }
}

async function importImportableRegion(
    ctx: TaskContext,
    importable: ImportableRegion,
): Promise<void> {
    const setPos = async (pos: Pos, corner: "A" | "B") => {
        ctx.runCommand(`/tp ${pos.x} ${pos.y} ${pos.z}`);
        await waitForUnformattedMessage(
            ctx,
            `Teleporting you to ${pos.x}, ${pos.y}, ${pos.z}.`,
        );

        ctx.runCommand(`//pos${corner}`);
        await waitForUnformattedMessage(
            ctx,
            `Position ${corner} set to ${pos.x}, ${pos.y}, ${pos.z}.`,
        );
    };

    await setPos(importable.bounds.from, "A");
    await setPos(importable.bounds.to, "B");

    ctx.runCommand(`/region edit ${importable.name}`);

    const alreadyExists = await ctx.withTimeout(
        Promise.race([
            waitForMenuToLoad(ctx).then(() => true),
            ctx
                .waitFor(
                    "message",
                    (message) =>
                        removedFormatting(message) ===
                        "Could not find a region with that name!",
                )
                .then(() => false),
        ]),
        "Waiting for region to open",
    );

    if (!alreadyExists) {
        ctx.runCommand(`/region create ${importable.name}`);
        await waitForUnformattedMessage(
            ctx,
            `Created region ${importable.name}!`,
        );

        ctx.runCommand(`/region edit ${importable.name}`);
        await waitForMenuToLoad(ctx);
    } else {
        ctx.getItemSlot("Move Region").click();
        await waitForUnformattedMessage(
            ctx,
            "Updated region to your current selection!",
        );

        ctx.runCommand(`/region edit ${importable.name}`);
        await waitForMenuToLoad(ctx);
    }

    if (importable.onEnterActions) {
        ctx.getItemSlot("Entry Actions").click();
        await waitForMenuToLoad(ctx);

        for (const action of importable.onEnterActions) {
            await importAction(ctx, action);
        }

        if (importable.onExitActions) {
            clickGoBack(ctx);
            await waitForMenuToLoad(ctx);
        }
    }

    if (importable.onExitActions) {
        ctx.getItemSlot("Exit Actions").click();
        await waitForMenuToLoad(ctx);

        for (const action of importable.onExitActions) {
            await importAction(ctx, action);
        }
    }
}
