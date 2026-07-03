import { Diagnostic, SourceMap, runtime, types } from "htsw";

import { printDiagnostic } from "../tui/diagnostics";

let active = false;
let sourceMap: SourceMap | null = null;
let importables: types.Importable[] = [];
let currentRuntime: runtime.Runtime | null = null;
let currentVars: runtime.simple.SimpleVars | null = null;

export function setSimulatorActive(value: boolean): void {
    active = value;
}

export function isSimulatorActive(): boolean {
    return active;
}

export function setSimulatorSource(sm: SourceMap, values: types.Importable[]): void {
    sourceMap = sm;
    importables = values;
}

export function setSimulatorRuntime(
    rt: runtime.Runtime,
    vars: runtime.simple.SimpleVars
): void {
    currentRuntime = rt;
    currentVars = vars;
}

export function getSimulatorImportables(): types.Importable[] {
    return importables;
}

export function getSimulatorRuntime(): runtime.Runtime {
    if (currentRuntime === null) throw new Error("Simulator runtime is not active.");
    return currentRuntime;
}

export function getSimulatorVars(): runtime.simple.SimpleVars {
    if (currentVars === null) throw new Error("Simulator variables are not active.");
    return currentVars;
}

export function runSimulatorActions(
    actions: types.Action[],
    childCtx: boolean = false
): void {
    try {
        getSimulatorRuntime().runActions(actions, childCtx);
    } catch (err) {
        if (err instanceof Diagnostic && sourceMap !== null) {
            printDiagnostic(sourceMap, err);
            return;
        }
        throw err;
    }
}
