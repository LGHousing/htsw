import type { VarHolder } from "./varHolder";
import type { Vars } from "./vars";

// Pull the registered handler map off a Behaviors instance for merging
// barebones defaults into a Simple*Behaviors subclass. Reaches into the
// private `handlers` field deliberately — the alternative (a public
// `entries()` on the base class) would commit Behaviors to that surface.
export function behaviorEntries<H>(behaviors: object): Array<[any, H]> {
    const handlers = (behaviors as unknown as {
        handlers: Record<string, H>;
    }).handlers;
    return Object.entries(handlers) as Array<[any, H]>;
}

// Dispatch a CHANGE_VAR / COMPARE_VAR holder discriminator to the
// corresponding VarHolder on a Vars instance.
export function holderFor(
    vars: Vars,
    holder: { type: "Player" } | { type: "Global" } | { type: "Team"; team?: string },
): VarHolder<string> {
    if (holder.type === "Team") return vars.team(holder.team ?? "");
    if (holder.type === "Global") return vars.global;
    return vars.player;
}
