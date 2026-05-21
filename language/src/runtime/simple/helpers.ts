import type { VarHolder } from "./varHolder";
import type { Vars } from "./vars";

// Pull the private handler map off a Behaviors instance for merging
// barebones defaults into a Simple*Behaviors subclass. Reaches into the
// private `handlers` field deliberately — a public `entries()` would
// commit Behaviors to that surface.
export function behaviorEntries<H>(behaviors: object): Array<[any, H]> {
    const handlers = (behaviors as unknown as {
        handlers: Record<string, H>;
    }).handlers;
    return Object.entries(handlers) as Array<[any, H]>;
}

export function holderFor(
    vars: Vars,
    holder: { type: "Player" } | { type: "Global" } | { type: "Team"; team?: string },
): VarHolder<string> {
    if (holder.type === "Team") return vars.team(holder.team ?? "");
    if (holder.type === "Global") return vars.global;
    return vars.player;
}
