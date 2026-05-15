import * as json from "jsonc-parser";
import { encodeFilesystemComponent } from "../utils/filesystem";

/**
 * Filesystem-safe encoding for an importable's identity, used to derive
 * `.htsl` filenames during export.
 *
 * Export filenames are user-facing, so dots are preserved when the rest of
 * the name is filesystem-safe.
 */
export function canonicalSlug(identity: string): string {
    return encodeFilesystemComponent(identity.split(" ").join("_"), {
        escapeDots: false,
    });
}

function readFunctionActionReferences(
    importJsonPath: string,
    identity: string
): { current: string | null; usedByOthers: Set<string> } {
    const result = { current: null as string | null, usedByOthers: new Set<string>() };
    if (!FileLib.exists(importJsonPath)) return result;

    const text = String(FileLib.read(importJsonPath) ?? "");
    if (text.trim() === "") return result;

    const tree = json.parseTree(text);
    if (!tree) return result;

    const sectionNode = json.findNodeAtLocation(tree, ["functions"]);
    if (!sectionNode || sectionNode.type !== "array") return result;

    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const nameNode = json.findNodeAtLocation(item, ["name"]);
        const actionsNode = json.findNodeAtLocation(item, ["actions"]);
        if (
            !nameNode ||
            nameNode.type !== "string" ||
            !actionsNode ||
            actionsNode.type !== "string"
        ) {
            continue;
        }

        const ref = String(actionsNode.value);
        if (nameNode.value === identity) {
            result.current = ref;
        } else {
            result.usedByOthers.add(ref);
        }
    }

    return result;
}

export function htslFilenameForFunctionExport(
    importJsonPath: string,
    identity: string
): string {
    const refs = readFunctionActionReferences(importJsonPath, identity);
    if (refs.current !== null) return refs.current;

    const slug = canonicalSlug(identity);
    const preferred = `${slug}.htsl`;
    if (!refs.usedByOthers.has(preferred)) return preferred;

    for (let i = 2; i < 1000; i++) {
        const candidate = `${slug}_${i}.htsl`;
        if (!refs.usedByOthers.has(candidate)) return candidate;
    }

    throw new Error(`Could not find an unused filename for function "${identity}".`);
}
