import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { isTaskCancelled } from "../tasks/manager";
import { importableIdentity, importableKey } from "../importables/identity";
import { npcLabel } from "../importables/npcs/listNpcs";
import { parseNpcPosIdentity } from "../importables/identity";
import { readImportableCache, recordHouseScan } from "../importCache/cache";
import {
    houseLockOwnedImportables,
    houseLockOwnedKeys,
    readHouseLock,
} from "../importCache/houseLock";
import {
    PRUNABLE_TYPES,
    isProtectedIdentity,
    isPrunableType,
    pruneTypeOf,
    type PrunableType,
} from "./registry";
import { emptyPrunePlan, type PrunePlan, type PruneTarget } from "./types";

export type PruneScanRequest = {
    /**
     * Everything the manifest declares, across the whole include tree. Must come
     * from a parse with no hard errors — anything a half-parse dropped reads here
     * as house content the file does not declare.
     */
    declared: readonly Importable[];
    housingUuid: string;
    /** Entry import.json, for the house.lock that decides ownership. */
    importJsonPath: string;
    /** Limits the scan to these types; defaults to every prunable type. */
    types?: readonly PrunableType[];
    onTypeScanned?: (type: PrunableType, found: number, undeclared: number) => void;
};

/**
 * Walks the live house and reports what it holds that the manifest does not.
 * Read-only — it opens Housing menus to enumerate names and nothing more.
 */
export async function scanHousePrunePlan(
    ctx: TaskContext,
    request: PruneScanRequest
): Promise<PrunePlan> {
    const plan = emptyPrunePlan();
    const declared = declaredIdentities(request.declared);
    const owned = houseLockOwnedKeys(readHouseLock(request.importJsonPath));
    const types = request.types ?? PRUNABLE_TYPES;

    for (const type of types) {
        ctx.checkCancelled();
        const spec = pruneTypeOf(type);

        let identities: string[];
        try {
            identities = await spec.list(ctx);
        } catch (error) {
            if (isTaskCancelled(error)) throw error;
            plan.scanFailures.push({ type, reason: errorMessage(error) });
            continue;
        }

        // A complete scan is the freshest knowledge of this house there is.
        recordScanIntoCache(type, request.housingUuid, identities);

        const declaredOfType = declared.get(type) ?? new Set<string>();
        let undeclared = 0;
        for (const identity of identities) {
            if (declaredOfType.has(normalizeIdentity(identity))) continue;
            if (isProtectedIdentity(spec, identity)) continue;
            if (spec.method === "clearActions" && isKnownAlreadyClear(request.housingUuid, type, identity)) {
                continue;
            }
            undeclared++;
            const target: PruneTarget = {
                type,
                identity,
                label: displayLabel(type, identity),
                method: spec.method,
                owned: owned.has(importableKey(type, identity)),
            };
            if (spec.method === "report") plan.unsupported.push(target);
            else plan.targets.push(target);
        }
        request.onTypeScanned?.(type, identities.length, undeclared);
    }

    return plan;
}

function declaredIdentities(
    importables: readonly Importable[]
): Map<Importable["type"], Set<string>> {
    const byType = new Map<Importable["type"], Set<string>>();
    for (const importable of importables) {
        let set = byType.get(importable.type);
        if (set === undefined) {
            set = new Set<string>();
            byType.set(importable.type, set);
        }
        set.add(normalizeIdentity(importableIdentity(importable)));
    }
    return byType;
}

// Housing matches names case-insensitively and ignores surrounding whitespace,
// so a manifest saying `Spawn` declares the house's `spawn`. Matches the
// importer's own lowercased comparisons.
function normalizeIdentity(identity: string): string {
    return identity.trim().toLowerCase();
}

function displayLabel(type: PrunableType, identity: string): string {
    if (type !== "NPC") return identity;
    return npcLabel({ name: "NPC", pos: parseNpcPosIdentity(identity) });
}

/**
 * Every house has all eighteen events, so listing every undeclared one as work
 * would bury the real findings. Only skips events the cache has verified empty;
 * unverified ones stay in the plan.
 */
function isKnownAlreadyClear(
    housingUuid: string,
    type: PrunableType,
    identity: string
): boolean {
    const entry = readImportableCache(housingUuid, type, identity);
    if (entry === null || entry.verified !== true) return false;
    const importable = entry.importable;
    if (importable.type !== "EVENT") return false;
    return importable.actions.length === 0;
}

/**
 * `recordHouseScan` drops the content baseline of anything the house no longer
 * has, so it must only ever see a complete scan. Best-effort — a failed cache
 * write does not invalidate the plan.
 */
function recordScanIntoCache(
    type: PrunableType,
    housingUuid: string,
    identities: readonly string[]
): void {
    try {
        if (type === "NPC") {
            const labels = new Map<string, string>();
            for (const identity of identities) {
                labels.set(identity, displayLabel(type, identity));
            }
            recordHouseScan(housingUuid, type, identities, labels);
            return;
        }
        recordHouseScan(housingUuid, type, identities);
    } catch (_error) {
        void _error;
    }
}

/**
 * The plan a save can produce without touching Housing at all.
 *
 * Watch mode reparses on every save, so an importable that the manifest used to
 * declare and no longer does is visible in memory the instant it disappears —
 * no house scan, no command cooldown, no waiting. Ownership is not in question
 * here: the lock recorded the importable because a previous import of this same
 * project created it.
 */
export function vanishedPrunePlan(
    declared: readonly Importable[],
    importJsonPath: string
): PrunePlan {
    const plan = emptyPrunePlan();
    const lock = readHouseLock(importJsonPath);
    if (lock === null) return plan;
    const declaredKeys = new Set<string>();
    for (const importable of declared) {
        declaredKeys.add(
            importableKey(importable.type, normalizeIdentity(importableIdentity(importable)))
        );
    }

    for (const entry of houseLockOwnedImportables(lock)) {
        const type = entry.type;
        if (!isPrunableType(type)) continue;
        const spec = pruneTypeOf(type);
        if (spec.method === "report") continue;
        if (isProtectedIdentity(spec, entry.identity)) continue;
        if (declaredKeys.has(importableKey(type, normalizeIdentity(entry.identity)))) {
            continue;
        }
        plan.targets.push({
            type,
            identity: entry.identity,
            label: displayLabel(type, entry.identity),
            method: spec.method,
            owned: true,
        });
    }
    return plan;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
