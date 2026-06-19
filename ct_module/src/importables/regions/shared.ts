import {
    timedWaitForMenu,
    timedWaitForUnformattedMessage,
} from "../../housingSync/gui/menuWait";
import TaskContext from "../../tasks/context";
import { removedFormatting, unique } from "../../utils/helpers";

export async function openRegionEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    await ctx.runCommand(`/region edit ${name}`);

    const menuWait = timedWaitForMenu(ctx, "commandMenuWait");
    const msgWait = ctx.waitFor(
        "message",
        (message) =>
            removedFormatting(message) ===
            "Could not find a region with that name!"
    );
    const opened = await ctx.withTimeout(
        ctx.race<boolean>([
            [menuWait.then(() => true), menuWait],
            [msgWait.then(() => false), msgWait],
        ]),
        "Waiting for region to open"
    );

    return opened ? "opened" : "missing";
}

export async function ensureRegionNamesExist(
    ctx: TaskContext,
    regionNames: readonly string[],
    onEach?: (name: string) => void
): Promise<void> {
    const names = unique(regionNames);
    if (names.length === 0) return;

    for (const name of names) {
        const status = await openRegionEditor(ctx, name);
        if (status === "opened") {
            // Region exists — nothing to do. No clickGoBack: /region edit opens a
            // parent-less "Close" menu; the next iteration/command replaces it.
            onEach?.(name);
            continue;
        }
        await ctx.runCommand(`/pos1`);
        await ctx.runCommand(`/pos2`);

        await ctx.runCommand(`/region create ${name}`);
        await timedWaitForUnformattedMessage(ctx, `Created region ${name}!`);
        onEach?.(name);
    }
}
