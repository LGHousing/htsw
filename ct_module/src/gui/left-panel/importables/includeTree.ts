import type { ImportJsonFileNode } from "htsw";
import type { ResultImport } from "./rowModel";

/**
 * The parser's include tree, re-exported for the Importables tree renderer.
 *
 * Node paths are in the parser's own format (the language fileLoader's
 * resolved form, backslashes on Windows for included files) — run them
 * through `canonicalPath` before comparing with GUI-side fullPaths.
 */
export type IncludeNode = ImportJsonFileNode;

export function includeTreeOf(r: ResultImport): IncludeNode {
    const tree = r.parse === null ? null : r.parse.importJson.fileTree;
    if (tree !== null) return tree;
    return { path: r.fullPath, importables: r.importables, includes: [] };
}

/** Importables in this node and everything it includes. */
export function subtreeImportableCount(node: IncludeNode): number {
    let n = node.importables.length;
    for (let i = 0; i < node.includes.length; i++) {
        n += subtreeImportableCount(node.includes[i]);
    }
    return n;
}
