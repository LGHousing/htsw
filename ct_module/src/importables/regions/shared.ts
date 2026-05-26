import {
    timedWaitForUnformattedMessage,
} from "../../importer/helpers";
import TaskContext from "../../tasks/context";
import { removedFormatting, unique } from "../../utils/helpers";
import { S30PacketWindowItems } from "../../utils/packets";
import { lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero } from "../../tasks/specifics/waitFor";

/**
 * The region editor opened via `/region edit <name>` is a leaf menu
 * with a `Close` item (closes the chest GUI entirely), NOT a `Go Back`
 * item like function/menu editors. If you reach the same editor via
 * `/regions` → click, Hypixel substitutes Go Back since that path has
 * a parent. Shell-check opens directly with `/region edit`, so it
 * gets Close.
 *
 * After the click the chest GUI is fully closed — there's no parent
 * menu to wait for. A single tick lets the close packet round-trip
 * before the caller sends its next command.
 */
async function closeRegionEditor(ctx: TaskContext): Promise<void> {
    const slot = ctx.tryGetMenuItemSlot("Close");
    if (slot === null) return;
    slot.click();
    await ctx.waitFor("tick");
}

export async function openRegionEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    await ctx.runCommand(`/region edit ${name}`);

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
            "Could not find a region with that name!"
    );

    const opened = await ctx.withTimeout(
        Promise.race([
            menuWaiter.then(() => true),
            messageWaiter.then(() => false),
        ]),
        "Waiting for region to open"
    );

    if (opened) {
        messageWaiter.cleanupWaiter?.();
        await ctx.waitFor("tick");
    } else {
        menuWaiter.cleanupWaiter?.();
    }

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
            await closeRegionEditor(ctx);
            continue;
        }
        await ctx.runCommand(`/pos1`);
        await ctx.runCommand(`/pos2`);

        await ctx.runCommand(`/region create ${name}`);
        await timedWaitForUnformattedMessage(ctx, `Created region ${name}!`);
    }
}
