import type { Diagnostic, ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import { importableFilePaths } from "./importablePaths";

/**
 * Diagnostics bucketed by the importable whose source file they live in.
 * `unattributed` holds diagnostics whose span resolves to no importable's
 * file (e.g. import.json-level errors, MENU slot lists — which
 * `SUB_LIST_KINDS` doesn't enumerate — or span-less diagnostics). Callers
 * that gate on errors treat `unattributed` as "surface it", never "hide
 * it", so a real error is never silently dropped.
 */
export type DiagnosticAttribution = {
    byImportable: Map<Importable, Diagnostic[]>;
    unattributed: Diagnostic[];
};

export type SeverityCounts = { errors: number; warnings: number };

// Memoized per ParseResult: the GUI swaps in a fresh ParseResult on every
// reparse, so the attribution is computed once per parse and reused across
// frames (the importables list re-renders every frame).
const cache = new WeakMap<ParseResult<Importable[]>, DiagnosticAttribution>();

export function attributeDiagnostics(
    parsed: ParseResult<Importable[]>
): DiagnosticAttribution {
    const hit = cache.get(parsed);
    if (hit !== undefined) return hit;

    const owners = new Map<string, Importable[]>();
    for (const imp of parsed.value) {
        const files = new Set<string>(importableFilePaths(imp, parsed));
        for (const f of files) {
            const list = owners.get(f);
            if (list === undefined) owners.set(f, [imp]);
            else list.push(imp);
        }
    }

    const byImportable = new Map<Importable, Diagnostic[]>();
    const unattributed: Diagnostic[] = [];
    const sm = parsed.gcx.sourceMap;
    for (const d of parsed.gcx.diagnostics) {
        const primary = d.spans.find((s) => s.kind === "primary") ?? d.spans[0];
        let path: string | undefined;
        if (primary !== undefined) {
            try {
                path = sm.getFileByPos(primary.span.start).path;
            } catch (_e) {
                path = undefined;
            }
        }
        const os = path !== undefined ? owners.get(path) : undefined;
        if (os !== undefined && os.length > 0) {
            for (const o of os) {
                const list = byImportable.get(o);
                if (list === undefined) byImportable.set(o, [d]);
                else list.push(d);
            }
        } else {
            unattributed.push(d);
        }
    }

    const result: DiagnosticAttribution = { byImportable, unattributed };
    cache.set(parsed, result);
    return result;
}

export function diagnosticCountsFor(
    parsed: ParseResult<Importable[]> | null,
    imp: Importable
): SeverityCounts {
    if (parsed === null) return { errors: 0, warnings: 0 };
    const ds = attributeDiagnostics(parsed).byImportable.get(imp);
    let errors = 0;
    let warnings = 0;
    if (ds !== undefined) {
        for (const d of ds) {
            if (d.level === "error" || d.level === "bug") errors++;
            else if (d.level === "warning") warnings++;
        }
    }
    return { errors, warnings };
}
