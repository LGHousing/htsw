import { VarHolder } from "./varHolder";

export interface Vars {
    readonly player: VarHolder<string>;
    readonly global: VarHolder<string>;
    team(name: string): VarHolder<string>;
}

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
