import {
    clickGoBack,
    timedWaitForMenu,
    timedWaitForUnformattedMessage,
} from "../../importer/helpers";
import TaskContext from "../../tasks/context";
import { removedFormatting, unique } from "../../utils/helpers";

export async function openRegionEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    await ctx.runCommand(`/region edit ${name}`);

    const opened = await ctx.withTimeout(
        Promise.race([
            timedWaitForMenu(ctx, "commandMenuWait").then(() => true),
            ctx
                .waitFor(
                    "message",
                    (message) =>
                        removedFormatting(message) ===
                        "Could not find a region with that name!"
                )
                .then(() => false),
        ]),
        "Waiting for region to open"
    );

    return opened ? "opened" : "missing";
}

export async function ensureRegionNamesExist(
    ctx: TaskContext,
    regionNames: readonly string[]
): Promise<void> {
    const names = unique(regionNames);
    if (names.length === 0) return;

    ctx.displayMessage(`&7Ensuring ${names.length} region shell(s) exist.`);

    for (const name of names) {
        const status = await openRegionEditor(ctx, name);
        if (status === "opened") {
            await clickGoBack(ctx);
            continue;
        }
        await ctx.runCommand(`/pos1`);
        await ctx.runCommand(`/pos2`);

        await ctx.runCommand(`/region create ${name}`);
        await timedWaitForUnformattedMessage(ctx, `Created region ${name}!`);
    }
}
