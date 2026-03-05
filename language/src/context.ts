import type { Diagnostic } from "./diagnostic";
import type { SourceMap } from "./sourceMap";
import type { Importable } from "./types";
import { SpanTable } from "./spanTable";

export class GlobalCtxt {
    path: string;

    sourceMap: SourceMap;
    spans: SpanTable;
    importables: Importable[];
    diagnostics: Diagnostic[];
    activeImportJsonPaths: string[];
    loadedImportJsonPaths: Set<string>;

    constructor(
        sourceMap: SourceMap,
        path: string,
        spans: SpanTable = new SpanTable(),
    ) {
        this.sourceMap = sourceMap;
        this.spans = spans;
        this.path = path;
        this.importables = [];
        this.diagnostics = [];
        this.activeImportJsonPaths = [];
        this.loadedImportJsonPaths = new Set<string>();
    }

    addDiagnostic(diag: Diagnostic) {
        this.diagnostics.push(diag);
    }

    isFailed(): boolean {
        return this.diagnostics.find(
            it => it.level === "error" || it.level === "bug"
        ) !== undefined;
    }

    resolvePath(path: string): string {
        return this.sourceMap.fileLoader.resolvePath(
            this.sourceMap.fileLoader.getParentPath(this.path),
            path
        );
    }

    readFile(path: string): string {
        return this.sourceMap.fileLoader.readFile(this.resolvePath(path));
    }

    fileExists(path: string): boolean {
        return this.sourceMap.fileLoader.fileExists(this.resolvePath(path));
    }

    subContext(path: string): GlobalCtxt {
        const gcx = new GlobalCtxt(this.sourceMap, this.resolvePath(path), this.spans);
        gcx.importables = this.importables;
        gcx.diagnostics = this.diagnostics;
        gcx.activeImportJsonPaths = this.activeImportJsonPaths;
        gcx.loadedImportJsonPaths = this.loadedImportJsonPaths;
        return gcx;
    }
}
