import {
    clickGoBack,
    timedWaitForUnformattedMessage,
} from "../../importer/helpers";
import TaskContext from "../../tasks/context";
import { removedFormatting, unique } from "../../utils/helpers";
import { S30PacketWindowItems } from "../../utils/packets";
import { lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero } from "../../tasks/specifics/waitFor";

export async function openMenuEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    await ctx.runCommand(`/menu edit ${name}`);

    const menuWaiter = ctx.waitFor("packetReceived", (packet) => {
        if (!(packet instanceof S30PacketWindowItems)) return false;
        const windowID = packet.func_148911_c();
        return (
            windowID !== 0 &&
            windowID !==
                lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero
        );
    });
    const messageWaiter = ctx.waitFor(
        "message",
        (message) =>
            removedFormatting(message) ===
            "Could not find a menu with that name!"
    );

    const opened = await ctx.withTimeout(
        Promise.race([
            menuWaiter.then(() => true),
            messageWaiter.then(() => false),
        ]),
        "Waiting for menu to open"
    );

    if (opened) {
        messageWaiter.cleanupWaiter?.();
        await ctx.waitFor("tick");
    } else {
        menuWaiter.cleanupWaiter?.();
    }

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
