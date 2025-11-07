import type { GlobalCtxt } from "../../context";
import type { Diagnostic } from "../../diagnostic";
import { type DeclaredVarState, type VarKey } from "./state";

function varKeyToString(key: VarKey) {
    if (key.holder.type === "team") {
        return `${key.holder.type} ${key.holder.team} ${key.key}`;
    } else {
        return `${key.holder.type} ${key.key}`;
    }
}

export class TyCtxt {
    gcx: GlobalCtxt;
    private states: Map<string, DeclaredVarState>;

    private constructor(gcx: GlobalCtxt, states: Map<string, DeclaredVarState>) {
        this.gcx = gcx;
        this.states = states;
    }

    static fromGlobalCtxt(gcx: GlobalCtxt): TyCtxt {
        return new TyCtxt(gcx, new Map());
    }

    hasState(key: VarKey): boolean {
        return this.states.has(varKeyToString(key));
    }

    getState(key: VarKey): DeclaredVarState | undefined {
        return this.states.get(varKeyToString(key));
    }

    setState(key: VarKey, state: DeclaredVarState) {
        this.states.set(varKeyToString(key), state);
    }

    removeState(key: VarKey) {
        this.states.delete(varKeyToString(key));
    }

    clearState() {
        this.states.clear();
    }

    clone(): TyCtxt {
        return new TyCtxt(
            this.gcx,
            new Map(
                JSON.parse(JSON.stringify([...this.states]))
            )
        );
    }

    addDiagnostic(diag: Diagnostic) {
        this.gcx.addDiagnostic(diag);
    }
}