import type { Importable } from "../types";

export type ImportJsonFileNode = {
    path: string;
    importables: Importable[];
    includes: ImportJsonFileNode[];
    reference?: boolean;
    missing?: boolean;
};

export class ImportJsonParseMetadata {
    fileTree: ImportJsonFileNode | null = null;
    houseUuid: string | null = null;

    private visitedPaths = new Set<string>();
    private declaringPathCache: WeakMap<Importable, string> | null = null;

    beginFile(path: string, parent?: ImportJsonFileNode): ImportJsonFileNode {
        const node: ImportJsonFileNode = {
            path,
            importables: [],
            includes: [],
        };
        if (parent === undefined) this.fileTree = node;
        else parent.includes.push(node);
        this.visitedPaths.add(path);
        this.declaringPathCache = null;
        return node;
    }

    hasVisited(path: string): boolean {
        return this.visitedPaths.has(path);
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

        type Edge = { parent: ImportJsonFileNode; index: number; backEdge: boolean };
        const edgesByPath = new Map<string, Edge[]>();
        const visit = (node: ImportJsonFileNode, stack: string[]): void => {
            for (let index = 0; index < node.includes.length; index++) {
                const child = node.includes[index];
                if (child.missing === true) continue;
                const edge = { parent: node, index, backEdge: stack.includes(child.path) };
                const edges = edgesByPath.get(child.path);
                if (edges === undefined) edgesByPath.set(child.path, [edge]);
                else edges.push(edge);
                if (child.reference !== true) visit(child, stack.concat([child.path]));
            }
        };
        visit(root, [root.path]);

        for (const [childPath, edges] of edgesByPath) {
            if (edges.length < 2) continue;
            const childDir = dirKey(childPath);
            let home: Edge | undefined;
            let designated: Edge | undefined;
            for (const edge of edges) {
                if (edge.parent.includes[edge.index].reference !== true) home = edge;
                if (edge.backEdge) continue;
                const parentDir = dirKey(edge.parent.path);
                if (!childDir.startsWith(parentDir + "/")) continue;
                if (designated === undefined || dirKey(designated.parent.path).length < parentDir.length) {
                    designated = edge;
                }
            }
            if (home === undefined || designated === undefined || designated === home) continue;
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
