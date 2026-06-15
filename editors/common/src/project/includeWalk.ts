import * as json from "jsonc-parser";
import type { ProjectFs } from "./fs";

export function walkImportJsonTree(
    fs: ProjectFs,
    entryPath: string,
    visit: (filePath: string, tree: json.Node) => boolean | undefined
): void {
    walkFile(fs, entryPath, visit, new Set<string>());
}

function pathKey(path: string): string {
    return path.split("\\").join("/").toLowerCase();
}

function walkFile(
    fs: ProjectFs,
    filePath: string,
    visit: (filePath: string, tree: json.Node) => boolean | undefined,
    visited: Set<string>
): boolean {
    const key = pathKey(filePath);
    if (visited.has(key)) return false;
    visited.add(key);
    if (!fs.exists(filePath)) return false;
    const text = fs.readFile(filePath);
    if (text.trim() === "") return false;
    const tree = json.parseTree(text);
    if (!tree) return false;
    if (visit(filePath, tree) === true) return true;

    const includeNode = json.findNodeAtLocation(tree, ["include"]);
    if (!includeNode || includeNode.type !== "array") return false;
    const children = includeNode.children ?? [];
    for (let i = 0; i < children.length; i++) {
        if (children[i].type !== "string") continue;
        const resolved = fs.resolvePath(fs.parentDir(filePath), String(children[i].value));
        if (walkFile(fs, resolved, visit, visited)) return true;
    }
    return false;
}

export function findDeclaringImportJson(
    fs: ProjectFs,
    entryPath: string,
    section: string,
    identityField: string,
    identity: string
): string | null {
    let found: string | null = null;
    walkImportJsonTree(fs, entryPath, (filePath, tree) => {
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
