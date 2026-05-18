import {
    clickGoBack,
    timedWaitForMenu,
    timedWaitForUnformattedMessage,
} from "../../importer/gui/helpers";
import TaskContext from "../../tasks/context";
import { removedFormatting, unique } from "../../utils/helpers";

export async function openMenuEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    await ctx.runCommand(`/menu edit ${name}`);

    const opened = await ctx.withTimeout(
        Promise.race([
            timedWaitForMenu(ctx, "commandMenuWait").then(() => true),
            ctx
                .waitFor(
                    "message",
                    (message) =>
                        removedFormatting(message) ===
                        "Could not find a menu with that name!"
                )
                .then(() => false),
        ]),
        "Waiting for menu to open"
    );

    return opened ? "opened" : "missing";
}

export async function ensureMenuNamesExist(
    ctx: TaskContext,
    menuNames: readonly string[]
): Promise<void> {
    const names = unique(menuNames);
    if (names.length === 0) return;

    ctx.displayMessage(`&7Ensuring ${names.length} menu shell(s) exist.`);

    for (const name of names) {
        const status = await openMenuEditor(ctx, name);
        if (status === "opened") {
            await clickGoBack(ctx);
            continue;
        }

        await ctx.runCommand(`/menu create ${name}`);
        await timedWaitForUnformattedMessage(ctx, `Created menu ${name}!`);
    }
}
