import { clickGoBack } from "../../importer/gui/menuUtils";
import {
    timedWaitForMenu,
    timedWaitForUnformattedMessage,
} from "../../importer/gui/menuWait";
import TaskContext from "../../tasks/context";
import { removedFormatting, unique } from "../../utils/helpers";

export async function openMenuEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    await ctx.runCommand(`/menu edit ${name}`);

    const menuWait = timedWaitForMenu(ctx, "commandMenuWait");
    const msgWait = ctx.waitFor(
        "message",
        (message) =>
            removedFormatting(message) ===
            "Could not find a menu with that name!"
    );
    const opened = await ctx.withTimeout(
        ctx.race<boolean>([
            [menuWait.then(() => true), menuWait],
            [msgWait.then(() => false), msgWait],
        ]),
        "Waiting for menu to open"
    );

    return opened ? "opened" : "missing";
}

export async function ensureMenuNamesExist(
    ctx: TaskContext,
    menuNames: readonly string[],
    onEach?: (name: string) => void
): Promise<void> {
    const names = unique(menuNames);
    if (names.length === 0) return;

    for (const name of names) {
        const status = await openMenuEditor(ctx, name);
        if (status === "opened") {
            await clickGoBack(ctx);
            onEach?.(name);
            continue;
        }

        await ctx.runCommand(`/menu create ${name}`);
        await timedWaitForUnformattedMessage(ctx, `Created menu ${name}!`);
        onEach?.(name);
    }
}
