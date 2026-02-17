import type { GlobalCtxt } from "../../context";
import type { Diagnostic } from "../../diagnostic";
import type { Span } from "../../span";
import { type DeclaredVarState, type VarKey } from "./state";

function varKeyToString(key: VarKey) {
    if (key.holder.type === "team") {
        return `${key.holder.type} ${key.holder.team} ${key.key}`;
    } else {
        return `${key.holder.type} ${key.key}`;
    }
}

function spanToString(span: Span): string {
    return `${span.start} ${span.end}`;
}

export class TyCtxt {
    gcx: GlobalCtxt;
    private states: Map<string, DeclaredVarState>;
    private emittedDiagnosticLocations: Set<string>;

    private constructor(
        gcx: GlobalCtxt,
        states: Map<string, DeclaredVarState>,
        emittedDiagnosticLocations: Set<string>
    ) {
        this.gcx = gcx;
        this.states = states;
        this.emittedDiagnosticLocations = emittedDiagnosticLocations;
    }

    static fromGlobalCtxt(gcx: GlobalCtxt): TyCtxt {
        return new TyCtxt(gcx, new Map(), new Set());
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
            ),
            this.emittedDiagnosticLocations,
        );
    }

    addDiagnostic(diag: Diagnostic) {
        // Before we add this diagnostic, check if we've already emitted a
        // diagnostic at this location!
        for (const ds of diag.spans) {
            if (this.emittedDiagnosticLocations.has(spanToString(ds.span))) return;

            this.emittedDiagnosticLocations.add(spanToString(ds.span));
        }
        
        this.gcx.addDiagnostic(diag);
    }
}