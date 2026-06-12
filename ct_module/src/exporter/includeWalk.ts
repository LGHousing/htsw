import * as json from "jsonc-parser";
import { FileSystemFileLoader } from "../utils/fileLoaders";

/**
 * File-level walk over an import.json include tree: the entry file, then
 * every file its `include` arrays reach, depth-first in declaration order.
 * Cycle- and duplicate-safe. Works on raw jsonc trees (no parse cache, no
 * language parser) so writers can resolve targets even when the project
 * currently has parse errors.
 *
 * `visit` returning true stops the walk.
 */
export function walkImportJsonTree(
    entryPath: string,
    visit: (filePath: string, tree: json.Node) => boolean | undefined
): void {
    walkFile(new FileSystemFileLoader(), entryPath, visit, new Set<string>());
}

function pathKey(p: string): string {
    return p.split("\\").join("/").toLowerCase();
}

function walkFile(
    loader: FileSystemFileLoader,
    filePath: string,
    visit: (filePath: string, tree: json.Node) => boolean | undefined,
    visited: Set<string>
): boolean {
    const key = pathKey(filePath);
    if (visited.has(key)) return false;
    visited.add(key);
    if (!FileLib.exists(filePath)) return false;
    const text = String(FileLib.read(filePath) ?? "");
    if (text.trim() === "") return false;
    const tree = json.parseTree(text);
    if (!tree) return false;
    if (visit(filePath, tree) === true) return true;
    const includeNode = json.findNodeAtLocation(tree, ["include"]);
    if (!includeNode || includeNode.type !== "array") return false;
    const children = includeNode.children ?? [];
    for (let i = 0; i < children.length; i++) {
        if (children[i].type !== "string") continue;
        const resolved = loader.resolvePath(
            loader.getParentPath(filePath),
            String(children[i].value)
        );
        if (walkFile(loader, resolved, visit, visited)) return true;
    }
    return false;
}

/**
 * The file within `entryPath`'s include tree whose `section` declares
 * `identity`, or null when none does. Relative references (`actions`,
 * `nbt`) resolve against their declaring file, so any write that touches
 * an existing entry must target the file this returns — writing into the
 * entry instead duplicates the declaration and breaks the whole parse.
 */
export function findDeclaringImportJson(
    entryPath: string,
    section: string,
    identityField: string,
    identity: string
): string | null {
    let found: string | null = null;
    walkImportJsonTree(entryPath, (filePath, tree) => {
        const sectionNode = json.findNodeAtLocation(tree, [section]);
        if (!sectionNode || sectionNode.type !== "array") return undefined;
        const items = sectionNode.children ?? [];
        for (let i = 0; i < items.length; i++) {
            const idNode = json.findNodeAtLocation(items[i], [identityField]);
            if (idNode && idNode.type === "string" && idNode.value === identity) {
                found = filePath;
                return true;
            }
        }
        return undefined;
    });
    return found;
}
