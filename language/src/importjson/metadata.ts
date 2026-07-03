import type { Importable } from "../types";

export type ImportJsonFileNode = {
    path: string;
    importables: Importable[];
    includes: ImportJsonFileNode[];
    /**
     * A repeat include of a file whose contents are recorded under another
     * ("home") node in this tree. Reference nodes are leaves: their
     * importables and includes are always empty. Cyclic includes are NOT
     * recorded at all — a cycle is a parse error, not a reference.
     */
    reference?: boolean;
    /** An include whose target file doesn't exist — a leaf, so tree
     * consumers can render the broken edge where it was declared. */
    missing?: boolean;
};

export class ImportJsonParseMetadata {
    fileTree: ImportJsonFileNode | null = null;
    houseUuid: string | null = null;

    private activePaths: string[] = [];
    private declaringPathCache: WeakMap<Importable, string> | null = null;

    beginFile(path: string, parent?: ImportJsonFileNode): ImportJsonFileNode {
        const node: ImportJsonFileNode = {
            path,
            importables: [],
            includes: [],
        };
        if (parent === undefined) this.fileTree = node;
        else parent.includes.push(node);
        this.activePaths.push(path);
        this.declaringPathCache = null;
        return node;
    }

    endFile(path: string): void {
        const top = this.activePaths.length - 1;
        if (this.activePaths[top] === path) {
            this.activePaths.pop();
            return;
        }
        const index = this.activePaths.indexOf(path);
        if (index !== -1) this.activePaths.splice(index, 1);
    }

    activeDepth(): number {
        return this.activePaths.length;
    }

    isActive(path: string): boolean {
        return this.activePaths.indexOf(path) !== -1;
    }

    cyclePath(path: string): string {
        return this.activePaths.concat([path]).join(" -> ");
    }

    hasVisited(path: string): boolean {
        return treeContainsPath(this.fileTree, path);
    }

    recordReference(fromNode: ImportJsonFileNode, path: string): void {
        fromNode.includes.push({
            path,
            importables: [],
            includes: [],
            reference: true,
        });
    }

    recordMissing(fromNode: ImportJsonFileNode, path: string): void {
        fromNode.includes.push({
            path,
            importables: [],
            includes: [],
            missing: true,
        });
    }

    /**
     * Parsing homes a file's contents under whichever includer reached it
     * first, which depends on include order, not on where the file lives.
     * This pass moves each full node to the include edge whose parent
     * DIRECTORY contains the file (deepest such parent wins), leaving a
     * reference at the old spot — so the tree agrees with the filesystem no
     * matter the include order. Files only included cross-folder keep their
     * first-visit home. Runs once, after the whole parse.
     */
    rehomeFileTree(): void {
        const root = this.fileTree;
        if (root === null) return;

        type Edge = { parent: ImportJsonFileNode; index: number };
        const edgesByPath = new Map<string, Edge[]>();
        const visit = (node: ImportJsonFileNode): void => {
            for (let index = 0; index < node.includes.length; index++) {
                const child = node.includes[index];
                if (child.missing === true) continue;
                const edges = edgesByPath.get(child.path);
                if (edges === undefined) edgesByPath.set(child.path, [{ parent: node, index }]);
                else edges.push({ parent: node, index });
                if (child.reference !== true) visit(child);
            }
        };
        visit(root);

        for (const [childPath, edges] of edgesByPath) {
            if (edges.length < 2) continue;
            const childDir = dirKey(childPath);
            let home: Edge | undefined;
            let designated: Edge | undefined;
            for (const edge of edges) {
                if (edge.parent.includes[edge.index].reference !== true) home = edge;
                const parentDir = dirKey(edge.parent.path);
                if (!childDir.startsWith(parentDir + "/")) continue;
                if (designated === undefined || dirKey(designated.parent.path).length < parentDir.length) {
                    designated = edge;
                }
            }
            if (home === undefined || designated === undefined || designated === home) continue;
            // Swap in place (arrays never change length, so the other
            // recorded indices stay valid). A reference edge can never sit
            // inside the moved subtree: that shape is a cycle, which the
            // parser rejects without recording a node.
            designated.parent.includes[designated.index] = home.parent.includes[home.index];
            home.parent.includes[home.index] = {
                path: childPath,
                importables: [],
                includes: [],
                reference: true,
            };
        }
    }

    recordImportables(node: ImportJsonFileNode, importables: Importable[]): void {
        node.importables.push(...importables);
        this.declaringPathCache = null;
    }

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
}

// Directory of a path with separators normalized, for containment checks only.
function dirKey(path: string): string {
    const norm = path.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? "" : norm.substring(0, slash);
}

// "Visited" means fully parsed: reference and missing leaves don't count,
// so a file that was missing at one edge still gets its own missing node
// (and its own diagnostic) at every other edge that includes it.
function treeContainsPath(node: ImportJsonFileNode | null, path: string): boolean {
    if (node === null) return false;
    if (node.reference !== true && node.missing !== true && node.path === path) return true;
    for (const child of node.includes) {
        if (treeContainsPath(child, path)) return true;
    }
    return false;
}
