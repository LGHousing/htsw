/// <reference types="../../CTAutocomplete" />

import { normalizePathSeparators } from "htsw-editor-common/project";
import { javaType } from "../utils/java";

let cachedMcRoot: string | null = null;

function mcRoot(): string {
    if (cachedMcRoot !== null) return cachedMcRoot;
    try {
        const Paths = javaType("java.nio.file.Paths");
        cachedMcRoot = normalizePathSeparators(
            String(Paths.get(".").toAbsolutePath().normalize().toString())
        );
    } catch (_e) {
        cachedMcRoot = "";
    }
    return cachedMcRoot;
}

/**
 * Normalize a path for storage / display. If the path passes through `/htsw/`
 * we anchor it there (`./htsw/...`); otherwise we relativize against the MC
 * root. The result always uses forward slashes.
 *
 * Settings files key projects by this form so a saved choice survives the
 * Minecraft instance folder moving.
 */
export function normalizeHtswPath(p: string): string {
    const norm = normalizePathSeparators(p);
    const idx = norm.lastIndexOf("/htsw/");
    if (idx >= 0) return `.${norm.substring(idx)}`;
    const root = mcRoot();
    if (root.length > 0 && norm.length > root.length) {
        if (norm.substring(0, root.length + 1) === `${root}/`) {
            return `./${norm.substring(root.length + 1)}`;
        }
    }
    if (root.length > 0 && norm === root) return ".";
    return norm;
}
