/**
 * Low-level menu/message wait primitives, broken out from helpers.ts so
 * paginatedList.ts can depend on them without creating a helpers ↔
 * paginatedList cycle (helpers.ts uses paginatedList for note-on-last-slot,
 * paginatedList needs `timedWaitForMenu` for page turns).
 *
 * Anything here is: synchronous-feeling wait, no clicking, no field setting.
 * Click + wait pairs live in helpers.ts.
 */
import TaskContext from "../tasks/context";
import { removedFormatting } from "../utils/helpers";
import { S30PacketWindowItems } from "../utils/packets";
import { lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero } from "../tasks/specifics/waitFor";
import { COST } from "./progress/costs";
import { timed } from "./progress/timing";

export async function waitForMenu(ctx: TaskContext): Promise<void> {
    await ctx.withTimeout(async () => {
        await ctx.waitFor("packetReceived", (packet) => {
            if (!(packet instanceof S30PacketWindowItems)) return false;
            const windowID = packet.func_148911_c();
            return (
                windowID !== 0 &&
                windowID !==
                    lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero
            );
        });

        // Netty handles packets from a worker thread but the packet is only
        // actually handled by Minecraft once it is synchronized with the main
        // thread. So we have to wait for the next tick so the packet will be
        // processed and the window items will be in the container.
        await ctx.waitFor("tick");
    }, "Waiting for menu to load");
}

export async function timedWaitForMenu(
    ctx: TaskContext,
    kind: "menuClickWait" | "pageTurnWait" | "goBackWait" | "commandMenuWait" = "menuClickWait"
): Promise<void> {
    const expected =
        kind === "pageTurnWait"
            ? COST.pageTurnWait
            : kind === "goBackWait"
              ? COST.goBackWait
              : kind === "commandMenuWait"
                ? COST.commandMenuWait
                : COST.menuClickWait;
    await timed(kind, expected, () => waitForMenu(ctx));
}

export async function waitForUnformattedMessage(
    ctx: TaskContext,
    message: string
): Promise<void> {
    await ctx.withTimeout(
        ctx.waitFor(
            "message",
            (chatMessage) => removedFormatting(chatMessage) === message
        ),
        "Waiting for message in chat"
    );
}

export async function timedWaitForUnformattedMessage(
    ctx: TaskContext,
    message: string,
    kind: "commandMessageWait" | "messageClickWait" = "commandMessageWait"
): Promise<void> {
    await timed(
        kind,
        kind === "messageClickWait" ? COST.messageClickWait : COST.commandMessageWait,
        () => waitForUnformattedMessage(ctx, message)
    );
}
