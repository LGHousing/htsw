import { Diagnostic, SourceMap, parseImportablesResult, type GlobalCtxt } from "htsw";
import type { Importable } from "htsw/types";

import { FileSystemFileLoader } from "../utils/files";
import type { KnowledgeState, KnowledgeWriter } from "../knowledge";
import { buildKnowledgeStatusRows } from "../knowledge";

export type DashboardFilter = "all" | "current" | "modified" | "unknown";

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

export type PreviewTabKind = "json" | "importable" | "htsl";

/**
 * One open preview tab in the right pane. `pinned: false` means it was opened
 * by a single click — VS Code-style preview tab — and will be replaced by the
 * next single-click preview. Double-clicking a row, or double-clicking the
 * tab itself, pins it so it survives further single clicks.
 *
 * `payload` interpretation by kind:
 *  - json:        absolute path of an import.json file (defaults to the active one).
 *  - importable:  DashboardRow.id (e.g. "FUNCTION:GUI Setup").
 *  - htsl:        DashboardRow.id of the function/event whose actions we render.
 */
export type PreviewTab = {
    id: string;
    kind: PreviewTabKind;
    title: string;
    pinned: boolean;
    payload: string;
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
    activeTask: null | { kind: "import" | "export" | "forget"; label: string };
    exportFunctionName: string;
    exportRoot: string;
    previewRowId: string | null;
    searchQuery: string;
    tabs: PreviewTab[];
    activeTabId: string | null;
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

export function diagnosticSummary(diagnostic: Diagnostic): string {
    return `${diagnostic.level}: ${diagnostic.message}`;
}

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
        previewRowId: null,
        searchQuery: "",
        tabs: [
            {
                id: "json:active",
                kind: "json",
                title: "import.json",
                pinned: true,
                payload: importPath,
            },
        ],
        activeTabId: "json:active",
    };
}

export function loadImportProject(importPath: string): LoadedProject {
    const sourceMap = new SourceMap(new FileSystemFileLoader());
    if (!sourceMap.fileLoader.fileExists(importPath)) {
        const resolved = sourceMap.fileLoader.resolvePath(
            sourceMap.fileLoader.getParentPath(importPath),
            importPath
        );
        return {
            kind: "error",
            message: `import.json file does not exist: ${resolved}`,
            diagnostics: [],
        };
    }

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
                knowledgeState: "unknown",
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
    const query = state.searchQuery.trim().toLowerCase();
    const filtered = state.rows.filter((row) => {
        if (state.filter !== "all" && row.knowledgeState !== state.filter) return false;
        if (query.length === 0) return true;
        const haystack = `${row.type} ${row.identity}`.toLowerCase();
        return haystack.indexOf(query) !== -1;
    });
    if (query.length > 0) {
        // Alphabetical when searching; preserve original order otherwise.
        const sorted = filtered.slice();
        sorted.sort((a, b) => {
            const an = a.identity.toLowerCase();
            const bn = b.identity.toLowerCase();
            if (an < bn) return -1;
            if (an > bn) return 1;
            return 0;
        });
        return sorted;
    }
    return filtered;
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
    return diagnostics.filter(isBlockingDiagnostic).length;
}

export function isBlockingDiagnostic(diagnostic: Diagnostic): boolean {
    return diagnostic.level === "error" || diagnostic.level === "bug";
}

function fallbackIdentity(importable: Importable): string {
    if (importable.type === "EVENT") return importable.event;
    return importable.name;
}
