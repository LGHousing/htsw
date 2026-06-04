import TaskContext from "../tasks/context";
import { removedFormatting } from "../utils/helpers";

/**
 * Resolve the 36-char UUID for the Housing the player is currently inside.
 *
 * Hypixel's `/wtfmap` reply looks like
 *   "You are currently playing on <UUID> ...".
 *
 * Callers should hold onto the returned UUID for the lifetime of a task
 * rather than calling this repeatedly: the value is stable while the player
 * stays in the same housing, and each call costs a `/wtfmap` round trip.
 */
export async function getCurrentHousingUuid(ctx: TaskContext): Promise<string> {
    await ctx.runCommand("/wtfmap");

    const message = await ctx.withTimeout(
        ctx.waitFor(
            "message",
            (msg) => removedFormatting(msg).startsWith("You are currently playing on"),
        ),
        "Waiting for /wtfmap reply"
    ).then(([msg]) => removedFormatting(msg));

    // "You are currently playing on " is 29 chars; UUIDs are 36 chars long.
    return message.substring(29, 65);
}
