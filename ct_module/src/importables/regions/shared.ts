import {
    clickGoBack,
    waitForMenu,
    waitForUnformattedMessage,
} from "../../importer/helpers";
import TaskContext from "../../tasks/context";
import { removedFormatting } from "../../utils/helpers";

export async function openRegionEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    ctx.runCommand(`/region edit ${name}`);

    const opened = await ctx.withTimeout(
        Promise.race([
            waitForMenu(ctx).then(() => true),
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

        ctx.runCommand(`/region create ${name}`);
        await waitForUnformattedMessage(ctx, `Created region ${name}!`);
    }
}

function unique(values: readonly string[]): string[] {
    const seen: Record<string, boolean> = {};
    const result: string[] = [];
    for (const value of values) {
        if (seen[value]) continue;
        seen[value] = true;
        result.push(value);
    }
    return result;
}
