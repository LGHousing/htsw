import {
    Diagnostic,
    SourceMap,
    parseImportablesResult,
    type GlobalCtxt,
} from "htsw";
import type { Importable } from "htsw/types";

import { FileSystemFileLoader } from "../utils/files";
import type { KnowledgeState, KnowledgeWriter } from "../knowledge";
import { buildKnowledgeStatusRows } from "../knowledge";

export type DashboardFilter =
    | "all"
    | "current"
    | "stale"
    | "missing"
    | "selected";

export type DashboardRow = {
    id: string;
    selected: boolean;
    importable: Importable;
    identity: string;
    type: Importable["type"];
    knowledgeState: KnowledgeState;
    sourceHash: string;
    cacheHash?: string;
    writer?: KnowledgeWriter;
};

export type DashboardState = {
    importPath: string;
    housingUuid: string | null;
    houseAlias: string | null;
    parseStatus:
        | { kind: "idle" }
        | { kind: "loading" }
        | { kind: "ready" }
        | { kind: "error"; message: string };
    diagnostics: Diagnostic[];
    rows: DashboardRow[];
    filter: DashboardFilter;
    trustModeEnabled: boolean;
    statusMessage: string | null;
    activeTask:
        | null
        | { kind: "import" | "export" | "forget"; label: string };
    exportFunctionName: string;
    exportRoot: string;
};

export type LoadedProject =
    | {
          kind: "ready";
          sourceMap: SourceMap;
          importables: Importable[];
          diagnostics: Diagnostic[];
          gcx: GlobalCtxt;
      }
    | { kind: "error"; message: string; diagnostics?: Diagnostic[] };

export function createInitialDashboardState(importPath: string): DashboardState {
    return {
        importPath,
        housingUuid: null,
        houseAlias: null,
        parseStatus: { kind: "idle" },
        diagnostics: [],
        rows: [],
        filter: "all",
        trustModeEnabled: false,
        statusMessage: null,
        activeTask: null,
        exportFunctionName: "",
        exportRoot: "",
    };
}

export function loadImportProject(importPath: string): LoadedProject {
    const sourceMap = new SourceMap(new FileSystemFileLoader());
    try {
        const result = parseImportablesResult(sourceMap, importPath);
        const blocking = countBlockingDiagnostics(result.diagnostics);
        if (blocking > 0) {
            return {
                kind: "error",
                message: `${blocking} blocking diagnostic${blocking === 1 ? "" : "s"}`,
                diagnostics: result.diagnostics,
            };
        }

        return {
            kind: "ready",
            sourceMap,
            importables: result.value,
            diagnostics: result.diagnostics,
            gcx: result.gcx,
        };
    } catch (error) {
        return {
            kind: "error",
            message: String(error),
            diagnostics: [],
        };
    }
}

export function rowsFromImportables(
    housingUuid: string | null,
    importables: readonly Importable[],
    previousRows: readonly DashboardRow[]
): DashboardRow[] {
    const selected = new Set(
        previousRows.filter((row) => row.selected).map((row) => row.id)
    );
    if (housingUuid === null) {
        return importables.map((importable, index) => {
            const identity = fallbackIdentity(importable);
            const id = `${importable.type}:${identity}`;
            return {
                id,
                selected: selected.has(id) || index === 0,
                importable,
                identity,
                type: importable.type,
                knowledgeState: "missing",
                sourceHash: "",
            };
        });
    }

    return buildKnowledgeStatusRows(housingUuid, importables).map((row, index) => {
        const id = `${row.importable.type}:${row.identity}`;
        return {
            id,
            selected: selected.has(id) || (previousRows.length === 0 && index === 0),
            importable: row.importable,
            identity: row.identity,
            type: row.importable.type,
            knowledgeState: row.state,
            sourceHash: row.hash,
            cacheHash: row.entry?.hash,
            writer: row.entry?.writer,
        };
    });
}

export function visibleRows(state: DashboardState): DashboardRow[] {
    return state.rows.filter((row) => {
        if (state.filter === "all") return true;
        if (state.filter === "selected") return row.selected;
        return row.knowledgeState === state.filter;
    });
}

export function isImportableSupported(importable: Importable): boolean {
    return (
        importable.type === "FUNCTION" ||
        importable.type === "EVENT" ||
        importable.type === "REGION" ||
        importable.type === "ITEM"
    );
}

export function countBlockingDiagnostics(diagnostics: readonly Diagnostic[]): number {
    return diagnostics.filter((it) => it.level === "error" || it.level === "bug").length;
}

function fallbackIdentity(importable: Importable): string {
    if (importable.type === "EVENT") return importable.event;
    return importable.name;
}
