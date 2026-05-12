/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Action, Importable } from "htsw/types";

import { readKnowledge } from "../../knowledge/cache";
import { actionHash } from "../../knowledge/hash";
import { cachePathFor, importableIdentity } from "../../knowledge/paths";

import {
    importableSourcePath,
    importableSubListPath,
    SUB_LIST_KINDS,
} from "./importablePaths";
import { getHousingUuid, getParsedResult } from "./index";
import { canonicalPath } from "./parses";
import type { DiffState } from "./diff";

/**
 * Source-vs-knowledge-cache diff for an `.htsl` source file.
 *
 * Compares each parsed source action's hash against the per-slot hash stored
 * in the knowledge cache (see `knowledge/hash.ts:listHashes`) and tags each
 * `actionPath` (matching the shape produced by `htsl-render.ts`) with:
 *
 *   - "match"   — slot hash present and equal
 *   - "edit"    — slot hash present and differs
 *   - "add"     — no slot entry (cache shorter, or list entirely absent)
 *   - "unknown" — no cache file exists for this importable (returned as
 *                 an empty map; caller falls back to "unknown")
 *
 * Path syntax in the cache (`actions[3].ifActions`) differs from the
 * dotted form used by the renderer (`3.ifActions.2`); we translate at the
 * lookup site rather than reshaping either side.
 */

function resolvePrefix(
    parsed: ParseResult<Importable[]>,
    path: string
): { imp: Importable; prefix: string } | null {
    const norm = canonicalPath(path);
    for (let i = 0; i < parsed.value.length; i++) {
        const imp = parsed.value[i];
        if (imp.type === "FUNCTION" || imp.type === "EVENT") {
            const primary = importableSourcePath(imp, parsed);
            if (primary !== undefined && canonicalPath(primary) === norm) {
                return { imp, prefix: "actions" };
            }
        }
        for (let k = 0; k < SUB_LIST_KINDS.length; k++) {
            const kind = SUB_LIST_KINDS[k];
            const sub = importableSubListPath(imp, kind, parsed);
            if (sub !== undefined && canonicalPath(sub) === norm) {
                return { imp, prefix: kind };
            }
        }
    }
    return null;
}

function bracketedToDotted(bracketed: string): string {
    return bracketed
        .split("[")
        .join(".")
        .split("]")
        .join("");
}

function walk(
    out: Map<string, DiffState>,
    prefix: string,
    parentBracketed: string,
    items: readonly Action[],
    lists: { [k: string]: string[] }
): void {
    const cacheKey = parentBracketed === "" ? prefix : `${prefix}${parentBracketed}`;
    const slots = lists[cacheKey];
    const parentDotted =
        parentBracketed === "" ? "" : `${bracketedToDotted(parentBracketed).substring(1)}.`;
    for (let i = 0; i < items.length; i++) {
        const action = items[i];
        const dotted = `${parentDotted}${i}`;
        const cachedHash = slots === undefined ? undefined : slots[i];
        const state: DiffState =
            cachedHash === undefined
                ? "add"
                : cachedHash === actionHash(action)
                  ? "match"
                  : "edit";
        out.set(dotted, state);
        if (action.type === "CONDITIONAL") {
            walk(out, prefix, `${parentBracketed}[${i}].ifActions`, action.ifActions, lists);
            walk(
                out,
                prefix,
                `${parentBracketed}[${i}].elseActions`,
                action.elseActions,
                lists
            );
        } else if (action.type === "RANDOM") {
            walk(out, prefix, `${parentBracketed}[${i}].actions`, action.actions, lists);
        }
    }
}

/**
 * Build the per-action diff map for `filePath`'s parsed `actions` against
 * the knowledge cache. Returns an empty map when there is no parsed
 * import.json, no housing UUID, no matching importable for the path, or no
 * cache entry yet — the renderer treats missing entries as "unknown".
 */
export function computeCacheDiff(
    filePath: string,
    sourceActions: readonly Action[]
): Map<string, DiffState> {
    const out = new Map<string, DiffState>();
    const parsed = getParsedResult();
    if (parsed === null) return out;
    const uuid = getHousingUuid();
    if (uuid === null) return out;
    const r = resolvePrefix(parsed, filePath);
    if (r === null) return out;
    const cache = readKnowledge(uuid, r.imp.type, importableIdentity(r.imp));
    if (cache === null) return out;
    walk(out, r.prefix, "", sourceActions, cache.lists);
    return out;
}

function mtimeOf(path: string): number {
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        const p = Paths.get(String(path));
        if (!Files.exists(p)) return 0;
        return Number(Files.getLastModifiedTime(p).toMillis());
    } catch (_e) {
        return 0;
    }
}

/**
 * Mtime of the knowledge cache file backing `filePath`, or 0 when either
 * the importable isn't resolved or the cache file doesn't exist. Cheap
 * (one filesystem stat) — intended as an invalidation key for callers
 * that memoize cache-diff results.
 */
export function cacheFileMtimeFor(filePath: string): number {
    const parsed = getParsedResult();
    if (parsed === null) return 0;
    const uuid = getHousingUuid();
    if (uuid === null) return 0;
    const r = resolvePrefix(parsed, filePath);
    if (r === null) return 0;
    return mtimeOf(cachePathFor(uuid, r.imp));
}
