import {
    clickGoBack,
    waitForMenu,
    waitForUnformattedMessage,
} from "../../importer/helpers";
import TaskContext from "../../tasks/context";
import { removedFormatting } from "../../utils/helpers";

export async function openMenuEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    ctx.runCommand(`/menu edit ${name}`);

    const opened = await ctx.withTimeout(
        Promise.race([
            waitForMenu(ctx).then(() => true),
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

        ctx.runCommand(`/menu create ${name}`);
        await waitForUnformattedMessage(ctx, `Created menu ${name}!`);
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
