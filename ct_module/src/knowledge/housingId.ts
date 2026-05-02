import TaskContext from "../tasks/context";
import { removedFormatting } from "../utils/helpers";

/**
 * Resolve the 36-char UUID for the Housing the player is currently inside.
 *
 * Hypixel's `/wtfmap` reply looks like
 *   "You are currently playing on <UUID> ...".
 *
 * Extracted from the item importer (see ImportableItem flow) so that both
 * the importer's post-sync cache write and the exporter can address the
 * same per-housing cache directory without a second `/wtfmap` round trip
 * each time. Callers should cache the returned UUID for the lifetime of
 * a task — the value is stable while the player stays in the same housing.
 */
export async function getCurrentHousingUuid(ctx: TaskContext): Promise<string> {
    await ctx.runCommand("/wtfmap");

    let message: string = "";
    await ctx.withTimeout(
        ctx.waitFor(
            "message",
            (chatMessage) =>
                removedFormatting(chatMessage).startsWith(
                    "You are currently playing on"
                ) &&
                (() => {
                    message = removedFormatting(chatMessage);
                    return true;
                })()
        ),
        "Waiting for /wtfmap reply"
    );

    // "You are currently playing on " is 29 chars; UUIDs are 36 chars long.
    return message.substring(29, 65);
}
