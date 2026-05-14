import { VarHolder } from "./varHolder";

// The storage contract that SimpleActionBehaviors / SimpleConditionBehaviors /
// SimplePlaceholderBehaviors expect. Consumers that need different storage
// semantics (e.g. the multi-player harness) implement this interface with
// their own player/global/team holders.
export interface Vars {
    readonly player: VarHolder<string>;
    readonly global: VarHolder<string>;
    team(name: string): VarHolder<string>;
}

// The default opinionated implementation: one VarHolder for player, one for
// global, and a lazily-created VarHolder per team name. This is what casual
// users instantiate alongside a barebones Runtime.
export class SimpleVars implements Vars {
    readonly player = new VarHolder<string>();
    readonly global = new VarHolder<string>();
    private readonly _teams = new Map<string, VarHolder<string>>();

    team(name: string): VarHolder<string> {
        let holder = this._teams.get(name);
        if (!holder) {
            holder = new VarHolder<string>();
            this._teams.set(name, holder);
        }
        return holder;
    }

    teamNames(): IterableIterator<string> {
        return this._teams.keys();
    }
}
