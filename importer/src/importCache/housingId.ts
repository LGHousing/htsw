import TaskContext from "../tasks/context";
import { removedFormatting } from "../utils/helpers";
import { reportHousingPresence } from "./housingPresence";
import { getAlias, setAlias } from "./aliases";

function houseNameFromMapMessage(rawMessage: string, uuid: string): string | null {
    const uuidIndex = rawMessage.indexOf(uuid);
    if (uuidIndex < 0) return null;
    const suffix = rawMessage
        .substring(uuidIndex + uuid.length)
        .replace(/§7 \(\d+\)$/, "")
        .trim();
    const plain = removedFormatting(suffix).trim();
    if (
        plain.length < 3 ||
        plain.charAt(0) !== "(" ||
        plain.charAt(plain.length - 1) !== ")"
    ) {
        return null;
    }
    const name = plain.substring(1, plain.length - 1).trim();
    return name.length === 0 ? null : name;
}

/**
 * Run `/wtfmap` and classify the reply:
 *  - "You are currently playing on <UUID> ..." → the 36-char housing UUID.
 *  - "Unknown command ..." → null. `/wtfmap` only exists inside a house, so
 *    Hypixel rejects it as unknown when the player is in a lobby/limbo.
 *
 * Throws on timeout (no recognizable reply). Use this from speculative
 * callers that don't yet know whether the player is in a house.
 */
export async function detectHousingUuid(ctx: TaskContext): Promise<string | null> {
    await ctx.runCommand("/wtfmap");

    const rawMessage = await ctx
        .withTimeout(
            ctx.waitFor("message", (msg) => {
                const m = removedFormatting(msg);
                return (
                    m.startsWith("You are currently playing on") ||
                    m.startsWith("Unknown command")
                );
            }),
            "Waiting for /wtfmap reply"
        )
        .then(([msg]) => msg);
    const message = removedFormatting(rawMessage);

    if (!message.startsWith("You are currently playing on")) {
        reportHousingPresence("out");
        return null;
    }

    // "You are currently playing on " is 29 chars; UUIDs are 36 chars long.
    const uuid = message.substring(29, 65);
    const houseName = houseNameFromMapMessage(rawMessage, uuid);
    if (houseName !== null && getAlias(uuid) === null) setAlias(uuid, houseName);
    reportHousingPresence("in");
    return uuid;
}

/**
 * Resolve the 36-char UUID for the Housing the player is currently inside.
 * Throws when the player isn't in a house — callers here are already
 * mid-operation inside one, so a missing house is a real error.
 *
 * Callers should hold onto the returned UUID for the lifetime of a task
 * rather than calling this repeatedly: the value is stable while the player
 * stays in the same housing, and each call costs a `/wtfmap` round trip.
 */
export async function getCurrentHousingUuid(ctx: TaskContext): Promise<string> {
    const uuid = await detectHousingUuid(ctx);
    if (uuid === null) {
        throw new Error("Not in a house — /wtfmap was rejected as an unknown command.");
    }
    return uuid;
}
