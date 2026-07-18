import type { ImportJsonFileNode } from "htsw";
import type { Importable } from "htsw/types";
import { importableIdentity } from "../../../importables/identity";
import type { ResultImport } from "./rowModel";
import { canonicalPath } from "../../parsing/parses";

/**
 * The parser's include tree, re-exported for the Projects tree renderer.
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

export function findImportableHome(
    node: IncludeNode,
    type: Importable["type"],
    identity: string
): { node: IncludeNode; imp: Importable } | null {
    if (node.reference !== true) {
        for (let i = 0; i < node.importables.length; i++) {
            const imp = node.importables[i];
            if (imp.type === type && importableIdentity(imp) === identity) {
                return { node, imp };
            }
        }
    }
    for (let i = 0; i < node.includes.length; i++) {
        const found = findImportableHome(node.includes[i], type, identity);
        if (found !== null) return found;
    }
    return null;
}
/** Importables in this node and everything it includes. */
export function subtreeImportableCount(node: IncludeNode): number {
    let n = node.importables.length;
    for (let i = 0; i < node.includes.length; i++) {
        n += subtreeImportableCount(node.includes[i]);
    }
    return n;
}

export function subtreeHouseExportCount(node: IncludeNode): number {
    let count = 0;
    for (let i = 0; i < node.importables.length; i++) {
        if (node.importables[i].type !== "ITEM") count++;
    }
    for (let i = 0; i < node.includes.length; i++) {
        count += subtreeHouseExportCount(node.includes[i]);
    }
    return count;
}

/** The full ("home") node for a file, skipping reference leaves. */
export function findIncludeNode(root: IncludeNode, targetPath: string): IncludeNode | null {
    if (root.reference !== true && canonicalPath(root.path) === targetPath) return root;
    for (let i = 0; i < root.includes.length; i++) {
        const found = findIncludeNode(root.includes[i], targetPath);
        if (found !== null) return found;
    }
    return null;
}

/**
 * Canonical paths of the group nodes between the tree root (exclusive) and
 * the home node for `targetPath` (exclusive) — the groups that must be
 * expanded for the home row to be visible. Null if the file has no home
 * node in this tree.
 */
export function includeAncestorPaths(root: IncludeNode, targetPath: string): string[] | null {
    const walk = (node: IncludeNode, trail: string[]): string[] | null => {
        if (node.reference === true) return null;
        if (canonicalPath(node.path) === targetPath) return trail;
        for (let i = 0; i < node.includes.length; i++) {
            const found = walk(node.includes[i], trail.concat([canonicalPath(node.path)]));
            if (found !== null) return found;
        }
        return null;
    };
    if (root.reference !== true && canonicalPath(root.path) === targetPath) return [];
    for (let i = 0; i < root.includes.length; i++) {
        const found = walk(root.includes[i], []);
        if (found !== null) return found;
    }
    return null;
}
