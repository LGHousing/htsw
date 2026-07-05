import type { Diagnostic } from "./diagnostic";
import { importableFilePaths } from "./importablePaths";
import type { Importable } from "./types";
import type { ImportablesParseResult } from "./index";

/**
 * Diagnostics bucketed by the importable whose source file they live in
 * (`importableFilePaths` — primary, child lists, and menu slot files), and by
 * that file itself. `unattributed` holds diagnostics whose span resolves to
 * no importable's file (e.g. import.json-level errors or span-less
 * diagnostics). Callers that gate on errors treat `unattributed` as
 * "surface it", never "hide it", so a real error is never silently dropped.
 */
export type DiagnosticAttribution = {
    byImportable: Map<Importable, Diagnostic[]>;
    byFile: Map<string, Diagnostic[]>;
    unattributed: Diagnostic[];
};

export type SeverityCounts = { errors: number; warnings: number };

// Memoized per ParseResult: consumers swap in a fresh ParseResult on every
// reparse, so the attribution is computed once per parse and reused.
const cache = new WeakMap<ImportablesParseResult, DiagnosticAttribution>();

export function attributeDiagnostics(
    parsed: ImportablesParseResult
): DiagnosticAttribution {
    const hit = cache.get(parsed);
    if (hit !== undefined) return hit;

    const owners = new Map<string, Importable[]>();
    for (const imp of parsed.value) {
        const files = new Set<string>(importableFilePaths(imp));
        for (const f of files) {
            const list = owners.get(f);
            if (list === undefined) owners.set(f, [imp]);
            else list.push(imp);
        }
    }

    const byImportable = new Map<Importable, Diagnostic[]>();
    const byFile = new Map<string, Diagnostic[]>();
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
        if (path !== undefined) {
            const fl = byFile.get(path);
            if (fl === undefined) byFile.set(path, [d]);
            else fl.push(d);
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

    const result: DiagnosticAttribution = { byImportable, byFile, unattributed };
    cache.set(parsed, result);
    return result;
}

function countLevels(ds: Diagnostic[] | undefined): SeverityCounts {
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

export function diagnosticCountsFor(
    parsed: ImportablesParseResult | null,
    imp: Importable
): SeverityCounts {
    if (parsed === null) return { errors: 0, warnings: 0 };
    return countLevels(attributeDiagnostics(parsed).byImportable.get(imp));
}

export function diagnosticCountsForFile(
    parsed: ImportablesParseResult | null,
    path: string
): SeverityCounts {
    if (parsed === null) return { errors: 0, warnings: 0 };
    return countLevels(attributeDiagnostics(parsed).byFile.get(path));
}
