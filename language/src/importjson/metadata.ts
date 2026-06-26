import type { Importable } from "../types";

export type ImportJsonFileNode = {
    path: string;
    importables: Importable[];
    includes: ImportJsonFileNode[];
};

export class ImportJsonParseMetadata {
    fileTree: ImportJsonFileNode | null = null;
    missingImportJsonPaths: string[] = [];
    houseUuid: string | null = null;

    private activePaths: string[] = [];
    private sourceFiles = new WeakMap<object, string>();
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

    recordMissingImportJsonPath(path: string): void {
        this.missingImportJsonPaths.push(path);
    }

    recordImportables(node: ImportJsonFileNode, importables: Importable[]): void {
        node.importables.push(...importables);
        this.declaringPathCache = null;
    }

    setSourcePath(object: object, path: string): void {
        this.sourceFiles.set(object, path);
    }

    sourcePathOf(object: object): string | undefined {
        return this.sourceFiles.get(object);
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

function treeContainsPath(node: ImportJsonFileNode | null, path: string): boolean {
    if (node === null) return false;
    if (node.path === path) return true;
    for (const child of node.includes) {
        if (treeContainsPath(child, path)) return true;
    }
    return false;
}
