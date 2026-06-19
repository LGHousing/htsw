/// <reference types="../../../CTAutocomplete" />

/**
 * Source diff: per-action `DiffState` derived from comparing the importable
 * cache (last successful import) against the current parsed source on disk.
 * The STATIC producer of the View tab's diff colors — "what would change vs
 * last import," shown when you're not importing.
 *
 * Decoupled from the live importer: live import events do NOT write here.
 * Computation is lazy — invoked the first time the View tab decorator asks
 * about a file. Cached entries are dropped (and recomputed on next access)
 * when:
 *
 *   1. The user edits a file (the parse changes, mtime-detected by
 *      `parseImportJsonAt`) → entries for files in that parse cleared.
 *   2. An import completes for an importable → that file's entry cleared.
 *
 * Compute uses per-slot hashes from the cache entry's importable — much
 * cheaper than re-running the importer's full structural diff. See
 * `importCache/hash.ts` for the hash spec.
 *
 * For the LIVE producer (import-in-progress), see `diffPalette.ts` (shared
 * vocabulary) and `livePreview.ts` (written from import event handlers).
 */

import type { ParseResult } from "htsw";
import type { Action, Condition, Importable } from "htsw/types";

import { normalizeHtswPath } from "../lib/pathDisplay";
import type { DiffState } from "./diffPalette";
import { readImportableCache } from "../../importCache/cache";
import { actionHash, conditionHash } from "../../importCache/hash";
import { importableIdentity } from "../../importCache/paths";
import { cacheEntryListHashes } from "../../importCache/status";
import {
    importableFilePaths,
    importableSourcePath,
    importableSubListPath,
    SUB_LIST_KINDS,
    type SubListKind,
} from "../parsing/importablePaths";
import { canonicalPath, forEachCachedParse } from "../parsing/parses";
import { getHousingUuid } from "../state/housing";
import { readCachedActionList } from "../../importables/actionListHelpers";

type SourceActionPathKey = string;

export type SourceDiffEntry = Map<SourceActionPathKey, DiffState>;

const entries: Map<string, SourceDiffEntry> = new Map();

function key(filePath: string): string {
    return normalizeHtswPath(filePath);
}

/**
 * Get-or-compute the cache-baseline overlay for `filePath`. On cache miss,
 * walks the cached parses to find the importable + list-prefix matching
 * this file, runs a hash-compare against the import cache, and stores
 * the result. Returns `undefined` if no cached parse references this
 * file or no cache entry exists yet (the user hasn't imported this).
 */
export function ensureSourceDiff(filePath: string): SourceDiffEntry | undefined {
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
export function invalidateSourceDiffForParse(parsed: ParseResult<Importable[]>): void {
    for (const importable of parsed.value) {
        invalidateSourceDiffForImportable(importable, parsed);
    }
}

/**
 * Drop overlay entries for one importable. Called after an import
 * succeeds (cache just got written → diff likely now empty).
 */
export function invalidateSourceDiffForImportable(
    importable: Importable,
    parsed: ParseResult<Importable[]>
): void {
    for (const p of importableFilePaths(importable, parsed)) {
        entries.delete(key(p));
    }
}

// ── Compute ───────────────────────────────────────────────────────────

function computeFor(filePath: string): SourceDiffEntry | null {
    const match = findFileTarget(filePath);
    if (match === null) return null;
    const housingUuid = getHousingUuid();
    if (housingUuid === null) return null;
    const cache = readImportableCache(
        housingUuid,
        match.importable.type,
        importableIdentity(match.importable)
    );
    if (cache === null) return null;
    const sourceActions = readCachedActionList(match.importable, match.prefix);
    if (sourceActions === undefined) return null;
    const cachedLists = cacheEntryListHashes(cache);
    const out: SourceDiffEntry = new Map();
    walk(out, match.prefix, "", sourceActions, cachedLists);
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

/**
 * The house's (cached) version of the action at a source line's dotted
 * action path, e.g. "3" or "0.ifActions.2". Backs the hover card on
 * "edit" lines so the user can see WHAT the house has, not just that it
 * differs. Returns null when the cache has no action at that path.
 */
export function houseActionAt(filePath: string, actionPath: string): Action | null {
    const match = findFileTarget(filePath);
    if (match === null) return null;
    const housingUuid = getHousingUuid();
    if (housingUuid === null) return null;
    const cache = readImportableCache(
        housingUuid,
        match.importable.type,
        importableIdentity(match.importable)
    );
    if (cache === null) return null;
    let list = readCachedActionList(cache.importable, match.prefix);
    let action: Action | null = null;
    const segments = actionPath.split(".");
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (/^\d+$/.test(seg)) {
            if (list === undefined) return null;
            action = list[Number(seg)] ?? null;
            if (action === null) return null;
            list = undefined;
        } else {
            if (action === null) return null;
            const nested = (action as unknown as Record<string, unknown>)[seg];
            if (!Array.isArray(nested)) return null;
            list = nested as Action[];
            action = null;
        }
    }
    return action;
}

function walk(
    out: SourceDiffEntry,
    prefix: string,
    parentBracketed: string,
    items: readonly Action[],
    lists: { [k: string]: string[] }
): void {
    const cacheKey = parentBracketed === "" ? prefix : `${prefix}${parentBracketed}`;
    const slots = lists[cacheKey];
    const parentDotted =
        parentBracketed === ""
            ? ""
            : `${bracketedToDotted(parentBracketed).substring(1)}.`;
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
            state = conditionsMatchCache(
                action.conditions,
                lists[`${cacheKey}[${i}].conditions`]
            )
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
            walk(
                out,
                prefix,
                `${parentBracketed}[${i}].ifActions`,
                action.ifActions,
                lists
            );
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
