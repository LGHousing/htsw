import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";
import { importableDeclaringPath } from "../../parsing/importablePaths";
import type { ResultImport } from "./rowModel";

/**
 * One import.json within a parse: the importables it declares directly plus
 * the files it includes. Mirrors the on-disk include structure so the
 * Importables tree can render included files as nested groups instead of one
 * merged flat list.
 *
 * `path` is in the parser's own format (the language fileLoader's resolved
 * form, backslashes on Windows for included files) — run it through
 * `canonicalPath` before comparing with GUI-side fullPaths.
 */
export type IncludeNode = {
    path: string;
    importables: Importable[];
    children: IncludeNode[];
};

// Keyed by the parse object: a reparse produces a new ParseResult, so stale
// trees fall out on their own.
const treeCache = new WeakMap<ParseResult<Importable[]>, IncludeNode>();

export function includeTreeOf(r: ResultImport): IncludeNode {
    if (r.parse === null) {
        return { path: r.fullPath, importables: r.importables, children: [] };
    }
    const hit = treeCache.get(r.parse);
    if (hit !== undefined) return hit;
    const built = buildIncludeTree(r.parse);
    treeCache.set(r.parse, built);
    return built;
}

function buildIncludeTree(parse: ParseResult<Importable[]>): IncludeNode {
    const byPath = new Map<string, Importable[]>();
    for (let i = 0; i < parse.value.length; i++) {
        const imp = parse.value[i];
        const p = importableDeclaringPath(imp, parse);
        const list = byPath.get(p);
        if (list !== undefined) list.push(imp);
        else byPath.set(p, [imp]);
    }
    const makeNode = (path: string): IncludeNode => {
        const childPaths = parse.gcx.includeEdges.get(path);
        return {
            path,
            importables: byPath.get(path) ?? [],
            children:
                childPaths === undefined ? [] : childPaths.map(makeNode),
        };
    };
    return makeNode(parse.gcx.path);
}

/** Importables in this node and everything it includes. */
export function subtreeImportableCount(node: IncludeNode): number {
    let n = node.importables.length;
    for (let i = 0; i < node.children.length; i++) {
        n += subtreeImportableCount(node.children[i]);
    }
    return n;
}
