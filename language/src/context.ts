import type { Diagnostic } from "./diagnostic";
import type { SourceMap } from "./sourceMap";
import type { Importable } from "./types";
import { SpanTable } from "./spanTable";

/**
 * One import.json in a parse: the importables it declares directly and the
 * files it includes, in declaration order. A node is attached when the file
 * is first visited — cycles, repeat includes, and missing files attach
 * nothing — so each file appears exactly once and the nodes form a tree
 * rooted at the entry file. Importables are the same objects as in the flat
 * `gcx.importables` list, which merges the whole tree.
 */
export type ImportJsonFileNode = {
    path: string;
    importables: Importable[];
    includes: ImportJsonFileNode[];
};

export class GlobalCtxt {
    path: string;

    sourceMap: SourceMap;
    spans: SpanTable;
    importables: Importable[];
    diagnostics: Diagnostic[];
    activeImportJsonPaths: string[];
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
     * The include structure of the parse. Null until `parseImportJson` visits
     * the entry file (and always null for plain .htsl action parses).
     */
    fileTree: ImportJsonFileNode | null;
    private declaringPathCache: WeakMap<Importable, string> | null;
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
        this.sourceFiles = new WeakMap<Importable, string>();
        this.fileTree = null;
        this.declaringPathCache = null;
        this.houseUuid = null;
    }

    /**
     * The import.json that DECLARED `importable` — unlike `sourceFiles`,
     * never the .htsl/.snbt the content lives in. Derived from `fileTree`
     * (the declaring file is the node holding the importable), so it works
     * for snapshot-restored parses too, which carry no spans.
     */
    declaringPathOf(importable: Importable): string | undefined {
        if (this.fileTree === null) return undefined;
        if (this.declaringPathCache === null) {
            const cache = new WeakMap<Importable, string>();
            const visit = (node: ImportJsonFileNode): void => {
                for (const imp of node.importables) cache.set(imp, node.path);
                for (const child of node.includes) visit(child);
            };
            visit(this.fileTree);
            this.declaringPathCache = cache;
        }
        return this.declaringPathCache.get(importable);
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
        gcx.sourceFiles = this.sourceFiles;
        gcx.fileTree = this.fileTree;
        return gcx;
    }
}
