/// <reference types="../../../CTAutocomplete" />

/**
 * Source diff: per-action `DiffState` derived from comparing the importable
 * cache (last successful import) against the current parsed source on disk.
 * The STATIC producer of the View tab's diff colors — "what would change vs
 * last import," shown when you're not importing.
 *
 * Decoupled from live task events: import/read/export progress does NOT write here.
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

import type { ImportablesParseResult } from "htsw";
import type { Action, Condition, Importable } from "htsw/types";

import { normalizeHtswPath } from "../lib/pathDisplay";
import { matchByHash } from "../../importCache/actionMatch";
import type { DiffState } from "./diffPalette";
import { readImportableCache } from "../../importCache/cache";
import { actionHash, conditionHash } from "../../importCache/hash";
import { importableIdentity } from "../../importables/identity";
import { cacheEntryListHashes } from "../../importCache/status";
import {
    importableFilePaths,
    importableSourcePath,
    importableChildListPath,
    IMPORTABLE_CHILD_LIST_NAMES,
    type ImportableChildListName,
} from "../parsing/importablePaths";
import {
    canonicalPath,
    forEachCachedParse,
    getParseAt,
    getParseCacheRevision,
} from "../parsing/parses";
import { getHousingUuid } from "../state/housing";
import { readCachedActionList } from "../../importCache/actionLists";

type SourceActionPathKey = string;

export type SourceDiffEntry = Map<SourceActionPathKey, DiffState>;

const entries: Map<string, SourceDiffEntry> = new Map();

function key(filePath: string, importJsonPath?: string | null): string {
    return `${importJsonPath === null || importJsonPath === undefined ? "" : normalizeHtswPath(importJsonPath)}\n${normalizeHtswPath(filePath)}`;
}

function deleteEntriesForFile(filePath: string): void {
    const fileKey = normalizeHtswPath(filePath);
    entries.delete(key(filePath));
    const suffix = "\n" + fileKey;
    const stale: string[] = [];
    entries.forEach((_value, entryKey) => {
        if (entryKey.indexOf(suffix) === entryKey.length - suffix.length) stale.push(entryKey);
    });
    for (let i = 0; i < stale.length; i++) entries.delete(stale[i]);
}

/**
 * Get-or-compute the cache-baseline overlay for `filePath`. On cache miss,
 * walks the cached parses to find the importable + list-prefix matching
 * this file, runs a hash-compare against the import cache, and stores
 * the result. Returns `undefined` if no cached parse references this
 * file or no cache entry exists yet (the user hasn't imported this).
 */
export function ensureSourceDiff(
    filePath: string,
    importJsonPath?: string | null
): SourceDiffEntry | undefined {
    const k = key(filePath, importJsonPath);
    const cached = entries.get(k);
    if (cached !== undefined) return cached;
    const computed = computeFor(filePath, importJsonPath);
    if (computed === null) return undefined;
    entries.set(k, computed);
    return computed;
}

/**
 * Drop all cached overlay entries that map to files referenced by this
 * parse. Called on parse refresh (file edit) so the next View-tab render
 * recomputes against the new parse + cache state.
 */
export function invalidateSourceDiffForParse(parsed: ImportablesParseResult): void {
    for (const importable of parsed.value) {
        invalidateSourceDiffForImportable(importable);
    }
}

/**
 * Drop overlay entries for one importable. Called after an import
 * succeeds (cache just got written → diff likely now empty).
 */
export function invalidateSourceDiffForImportable(importable: Importable): void {
    for (const p of importableFilePaths(importable)) {
        deleteEntriesForFile(p);
    }
}

// ── Compute ───────────────────────────────────────────────────────────

function computeFor(filePath: string, importJsonPath?: string | null): SourceDiffEntry | null {
    const match = findFileTarget(filePath, importJsonPath);
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
    walk(out, cacheListPrefix(match, cache.importable), "", "", sourceActions, cachedLists);
    return out;
}

export type FileTarget = {
    importable: Importable;
    /** Parse-side list prefix: "actions" / "onEnterActions" / ... /
     * "slots[2].actions" (index into the PARSED menu's slots array). */
    prefix: string;
    /** For MENU slot targets: the Housing slot number. The cached menu's
     * slots array can be ordered differently than the parsed one, so cache
     * lookups re-locate the slot by number via `cacheListPrefix`. */
    menuSlot?: number;
};

function cacheListPrefix(match: FileTarget, cached: Importable): string {
    if (match.menuSlot === undefined) return match.prefix;
    if (cached.type === "MENU") {
        for (let i = 0; i < cached.slots.length; i++) {
            if (cached.slots[i].slot === match.menuSlot) return `slots[${i}].actions`;
        }
    }
    // Slot absent from the cached menu: every list lookup misses, so the
    // whole source list reads as added — which is what an import would do.
    return "slots[-1].actions";
}

// Per-(path, parse-cache revision) memo. `findFileTarget` resolves the
// path of EVERY importable in EVERY cached parse (each through several
// `canonicalPath` Java NIO calls), and the tab strip calls it per file tab
// per frame — without this, one large project left in the cache costs
// thousands of filesystem calls every frame until /ct reload.
let fileTargetCacheRev = -1;
const fileTargetCache = new Map<string, FileTarget | null>();

export function findFileTarget(filePath: string, importJsonPath?: string | null): FileTarget | null {
    const rev = getParseCacheRevision();
    if (rev !== fileTargetCacheRev) {
        fileTargetCache.clear();
        fileTargetCacheRev = rev;
    }
    const norm = canonicalPath(filePath);
    const cacheKey = key(norm, importJsonPath);
    if (fileTargetCache.has(cacheKey)) return fileTargetCache.get(cacheKey) ?? null;
    let found: FileTarget | null = null;
    const visitParse = (parsed: ImportablesParseResult): void => {
        for (const importable of parsed.value) {
            if (importable.type === "FUNCTION" || importable.type === "EVENT") {
                const primary = importableSourcePath(importable);
                if (primary !== undefined && canonicalPath(primary) === norm) {
                    found = { importable, prefix: "actions" };
                    return;
                }
            }
            for (let k = 0; k < IMPORTABLE_CHILD_LIST_NAMES.length; k++) {
                const kind: ImportableChildListName = IMPORTABLE_CHILD_LIST_NAMES[k];
                const sub = importableChildListPath(importable, kind);
                if (sub !== undefined && canonicalPath(sub) === norm) {
                    found = { importable, prefix: kind };
                    return;
                }
            }
            if (importable.type === "MENU") {
                for (let s = 0; s < importable.slots.length; s++) {
                    const slot = importable.slots[s];
                    if (
                        slot.actionsPath !== undefined &&
                        canonicalPath(slot.actionsPath) === norm
                    ) {
                        found = {
                            importable,
                            prefix: `slots[${s}].actions`,
                            menuSlot: slot.slot,
                        };
                        return;
                    }
                }
            }
        }
    };
    if (importJsonPath !== null && importJsonPath !== undefined && importJsonPath !== "") {
        const entry = getParseAt(importJsonPath);
        if (entry !== null && entry.parsed !== null) visitParse(entry.parsed);
    } else {
        forEachCachedParse((entry) => {
            if (entry.parsed === null || found !== null) return;
            visitParse(entry.parsed);
        });
    }
    fileTargetCache.set(cacheKey, found);
    return found;
}

/**
 * The house's (cached) version of the action at a source line's dotted
 * action path, e.g. "3" or "0.ifActions.2". Backs the hover card on
 * "edit" lines so the user can see WHAT the house has, not just that it
 * differs. Returns null when the cache has no action at that path.
 */
export function houseActionAt(
    filePath: string,
    actionPath: string,
    importJsonPath?: string | null
): Action | null {
    const match = findFileTarget(filePath, importJsonPath);
    if (match === null) return null;
    const housingUuid = getHousingUuid();
    if (housingUuid === null) return null;
    const cache = readImportableCache(
        housingUuid,
        match.importable.type,
        importableIdentity(match.importable)
    );
    if (cache === null) return null;
    let list = readCachedActionList(cache.importable, cacheListPrefix(match, cache.importable));
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
            const childList = (action as unknown as Record<string, unknown>)[seg];
            if (!Array.isArray(childList)) return null;
            list = childList as Action[];
            action = null;
        }
    }
    return action;
}

function walk(
    out: SourceDiffEntry,
    prefix: string,
    cacheBracketed: string,
    sourceDotted: string,
    items: readonly Action[],
    lists: { [k: string]: string[] }
): void {
    const cacheKey = cacheBracketed === "" ? prefix : `${prefix}${cacheBracketed}`;
    const slots = lists[cacheKey];
    // Match source actions to their cache slot by hash, NOT by position — an
    // action inserted (or removed) at the top shifts every later index, and a
    // positional compare reads that whole tail as edited/added. See `matchByHash`.
    const sourceHashes = items.map((a) => actionHash(a));
    const matched = matchByHash(sourceHashes, slots);
    for (let i = 0; i < items.length; i++) {
        const action = items[i];
        const dotted = sourceDotted === "" ? `${i}` : `${sourceDotted}.${i}`;
        const j = matched[i];
        let state: DiffState;
        if (j === null) {
            state = "add";
        } else if (action.type === "CONDITIONAL") {
            // A CONDITIONAL's own line is its head — `if (conditions) {`. The full
            // hash also covers ifActions/elseActions, which are diffed on their own
            // child lines below, so judge the head by its conditions alone.
            // Otherwise adding/editing an action inside would light the head and
            // make it look like the conditions changed.
            state = conditionsMatchCache(
                action.conditions,
                lists[`${cacheKey}[${j}].conditions`]
            )
                ? "match"
                : "edit";
        } else if (action.type === "RANDOM") {
            // `random {` has no head fields; child-list changes show on child lines.
            state = "match";
        } else {
            state = slots !== undefined && slots[j] === sourceHashes[i] ? "match" : "edit";
        }
        out.set(dotted, state);
        // Recurse into child lists against the MATCHED cache slot `j`, so a
        // shifted CONDITIONAL/RANDOM still lines up with its cached body. For an
        // added action (j === null) there is no counterpart; `[-1]` can't be a
        // real cache index, so the child-list lookups miss and the body reports as
        // added too.
        const childIndex = j === null ? -1 : j;
        if (action.type === "CONDITIONAL") {
            walk(
                out,
                prefix,
                `${cacheBracketed}[${childIndex}].ifActions`,
                `${dotted}.ifActions`,
                action.ifActions,
                lists
            );
            walk(
                out,
                prefix,
                `${cacheBracketed}[${childIndex}].elseActions`,
                `${dotted}.elseActions`,
                action.elseActions,
                lists
            );
        } else if (action.type === "RANDOM") {
            walk(
                out,
                prefix,
                `${cacheBracketed}[${childIndex}].actions`,
                `${dotted}.actions`,
                action.actions,
                lists
            );
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
