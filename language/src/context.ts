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
    /**
     * Maps each parsed importable to the resolved path of the file that owns
     * its primary content — for FUNCTION/EVENT this is the referenced .htsl
     * (where the action body lives), for ITEM/MENU/REGION/NPC it is the
     * import.json that declared them. Lives off the importable to avoid
     * touching the importable's own keys (which knowledge-cache hashing
     * walks via Object.keys — see ct_module/src/knowledge/hash.ts).
     */
    sourceFiles: WeakMap<Importable, string>;
    /**
     * The import.json that DECLARED each importable — unlike `sourceFiles`,
     * never the .htsl/.snbt the content lives in. Stored as data (not
     * derived from spans) so snapshot-restored parses, which carry no
     * spans, can still group importables by declaring file.
     */
    declaringFiles: WeakMap<Importable, string>;
    /**
     * Which import.json included which: resolved includer path → resolved
     * included paths, in declaration order. An edge is recorded only when
     * the include actually triggers a load — cycles, duplicates, and missing
     * files record nothing — so the edges always form a tree rooted at the
     * entry file.
     */
    includeEdges: Map<string, string[]>;
    /**
     * Housing UUID the entry import.json declares via its top-level
     * "houseUuid" key, or null when unbound. Only the entry file's
     * declaration counts — one parse describes one house, and an included
     * file's binding still applies when that file is parsed as the entry.
     */
    houseUuid: string | null;

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
        this.sourceFiles = new WeakMap<Importable, string>();
        this.declaringFiles = new WeakMap<Importable, string>();
        this.includeEdges = new Map<string, string[]>();
        this.houseUuid = null;
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
        gcx.sourceFiles = this.sourceFiles;
        gcx.declaringFiles = this.declaringFiles;
        gcx.includeEdges = this.includeEdges;
        return gcx;
    }
}
