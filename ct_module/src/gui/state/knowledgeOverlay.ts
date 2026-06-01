/// <reference types="../../../CTAutocomplete" />

/**
 * Knowledge overlay: per-action `DiffState` derived from comparing the
 * importable cache (last successful import) against the current parsed
 * source on disk. Powers the View tab's diff colors.
 *
 * This store is **completely decoupled from the live importer.** Live
 * import events do NOT write here. Computation is lazy — invoked the
 * first time the View tab decorator asks about a file. Cached entries
 * are dropped (and recomputed on next access) when:
 *
 *   1. The user edits a file (the parse changes, mtime-detected by
 *      `parseImportJsonAt`) → entries for files in that parse cleared.
 *   2. An import completes for an importable → that file's entry cleared.
 *
 * Compute uses the per-slot hashes the cache writer already stored on
 * `ImportableCacheEntry.lists` — much cheaper than re-running the
 * importer's full structural diff. See `importCache/hash.ts` for the
 * hash spec.
 *
 * For the live-import animation, see `diff.ts` / `importPreviewState.ts`,
 * which are written from import event handlers.
 */

import type { ParseResult } from "htsw";
import type { Action, Condition, Importable } from "htsw/types";

import { normalizeHtswPath } from "../lib/pathDisplay";
import type { ActionPath } from "../../importer/importEvents";
import type { DiffState } from "./diff";
import { readImportableCache } from "../../importCache/cache";
import { actionHash, conditionHash } from "../../importCache/hash";
import { importableIdentity } from "../../importCache/paths";
import {
    importableSourcePath,
    importableSubListPath,
    SUB_LIST_KINDS,
    type SubListKind,
} from "./importablePaths";
import { canonicalPath, forEachCachedParse } from "./parses";
import { getHousingUuid } from ".";
import { readCachedActionList } from "../../importables/actionListHelpers";

export type KnowledgeOverlayEntry = Map<ActionPath, DiffState>;

const entries: Map<string, KnowledgeOverlayEntry> = new Map();

function key(filePath: string): string {
    return normalizeHtswPath(filePath);
}

/**
 * Get-or-compute the knowledge overlay for `filePath`. On cache miss,
 * walks the cached parses to find the importable + list-prefix matching
 * this file, runs a hash-compare against the import cache, and stores
 * the result. Returns `undefined` if no cached parse references this
 * file or no cache entry exists yet (the user hasn't imported this).
 */
export function ensureKnowledgeOverlay(filePath: string): KnowledgeOverlayEntry | undefined {
    const k = key(filePath);
    const cached = entries.get(k);
    if (cached !== undefined) return cached;
    const computed = computeFor(filePath);
    if (computed === null) return undefined;
    entries.set(k, computed);
    return computed;
}

/**
 * Drop all cached overlay entries that map to files referenced by this
 * parse. Called on parse refresh (file edit) so the next View-tab render
 * recomputes against the new parse + cache state.
 */
export function invalidateKnowledgeOverlayForParse(
    parsed: ParseResult<Importable[]>
): void {
    for (const importable of parsed.value) {
        const primary = importableSourcePath(importable, parsed);
        if (primary !== undefined) entries.delete(key(primary));
        for (let i = 0; i < SUB_LIST_KINDS.length; i++) {
            const subPath = importableSubListPath(importable, SUB_LIST_KINDS[i], parsed);
            if (subPath !== undefined) entries.delete(key(subPath));
        }
    }
}

/**
 * Drop overlay entries for one importable. Called after an import
 * succeeds (cache just got written → diff likely now empty).
 */
export function invalidateKnowledgeOverlayForImportable(
    importable: Importable,
    parsed: ParseResult<Importable[]>
): void {
    const primary = importableSourcePath(importable, parsed);
    if (primary !== undefined) entries.delete(key(primary));
    for (let i = 0; i < SUB_LIST_KINDS.length; i++) {
        const subPath = importableSubListPath(importable, SUB_LIST_KINDS[i], parsed);
        if (subPath !== undefined) entries.delete(key(subPath));
    }
}

// ── Compute ───────────────────────────────────────────────────────────

function computeFor(filePath: string): KnowledgeOverlayEntry | null {
    const match = findFileTarget(filePath);
    if (match === null) return null;
    const housingUuid = getHousingUuid();
    if (housingUuid === null) return null;
    const cache = readImportableCache(
        housingUuid,
        match.importable.type,
        importableIdentity(match.importable)
    );
    const sourceActions = readCachedActionList(match.importable, match.prefix);
    if (sourceActions === undefined) return null;
    const out: KnowledgeOverlayEntry = new Map();
    walk(out, match.prefix, "", sourceActions, cache !== null ? cache.lists : {});
    return out;
}

export type FileTarget = {
    importable: Importable;
    /** Cache-list prefix: "actions" / "onEnterActions" / "leftClickActions" / ... */
    prefix: string;
};

export function findFileTarget(filePath: string): FileTarget | null {
    const norm = canonicalPath(filePath);
    let found: FileTarget | null = null;
    forEachCachedParse((entry) => {
        if (entry.parsed === null || found !== null) return;
        for (const importable of entry.parsed.value) {
            if (importable.type === "FUNCTION" || importable.type === "EVENT") {
                const primary = importableSourcePath(importable, entry.parsed);
                if (primary !== undefined && canonicalPath(primary) === norm) {
                    found = { importable, prefix: "actions" };
                    return;
                }
            }
            for (let k = 0; k < SUB_LIST_KINDS.length; k++) {
                const kind: SubListKind = SUB_LIST_KINDS[k];
                const sub = importableSubListPath(importable, kind, entry.parsed);
                if (sub !== undefined && canonicalPath(sub) === norm) {
                    found = { importable, prefix: kind };
                    return;
                }
            }
        }
    });
    return found;
}

function walk(
    out: KnowledgeOverlayEntry,
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
        let state: DiffState;
        if (cachedHash === undefined) {
            state = "add";
        } else if (action.type === "CONDITIONAL") {
            // A CONDITIONAL's own line is its head — `if (conditions) {`. The full
            // hash also covers ifActions/elseActions, which are diffed on their own
            // child lines below, so judge the head by its conditions alone.
            // Otherwise adding/editing an action inside would light the head and
            // make it look like the conditions changed.
            state = conditionsMatchCache(action.conditions, lists[`${cacheKey}[${i}].conditions`])
                ? "match"
                : "edit";
        } else if (action.type === "RANDOM") {
            // `random {` has no head fields; nested changes show on child lines.
            state = "match";
        } else {
            state = cachedHash === actionHash(action) ? "match" : "edit";
        }
        out.set(dotted, state);
        if (action.type === "CONDITIONAL") {
            walk(out, prefix, `${parentBracketed}[${i}].ifActions`, action.ifActions, lists);
            walk(out, prefix, `${parentBracketed}[${i}].elseActions`, action.elseActions, lists);
        } else if (action.type === "RANDOM") {
            walk(out, prefix, `${parentBracketed}[${i}].actions`, action.actions, lists);
        }
    }
}

function conditionsMatchCache(
    conditions: readonly Condition[],
    cachedHashes: string[] | undefined
): boolean {
    if (cachedHashes === undefined) return conditions.length === 0;
    if (cachedHashes.length !== conditions.length) return false;
    for (let i = 0; i < conditions.length; i++) {
        if (cachedHashes[i] !== conditionHash(conditions[i])) return false;
    }
    return true;
}

function bracketedToDotted(bracketed: string): string {
    // "[0].ifActions[2]" → ".0.ifActions.2"
    return bracketed.split("[").join(".").split("]").join("");
}
