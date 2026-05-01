import type { Action, Condition, Importable } from "htsw/types";

import { cyrb53 } from "../utils/helpers";
import {
    normalizeActionCompare,
    normalizeConditionCompare,
} from "../importer/compare";

/**
 * Knowledge-cache hashing.
 *
 * The exporter writes a knowledge entry after a fresh GUI read; the
 * importer writes one after every successful sync. Both must produce
 * **identical** hashes for identical importables, otherwise the
 * future trust-mode will treat them as drift.
 *
 * To keep that invariant, we feed every value through the same
 * `normalizeActionCompare` / `normalizeConditionCompare` that the importer
 * already uses for its diff equality checks. As long as those two
 * normalizers stay equivalent (they're literally the same function via
 * `normalizeValue`), the hash and the diff comparator cannot drift apart.
 */

/** Hex-encoded 53-bit cyrb53 digest, prefixed with "0x" for clarity in JSON. */
function hashHex(input: string): string {
    return "0x" + cyrb53(input).toString(16);
}

/**
 * Stable JSON: keys sorted, undefined dropped, empty arrays dropped.
 *
 * The normalizer already does most of this for objects we know are
 * actions or conditions, but the surrounding importable shell
 * (`{ type, name, actions: [...] }`) hasn't been normalized — we still
 * need a deterministic stringify for it.
 */
function stableStringify(value: unknown): string {
    if (value === null) return "null";
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return "[" + value.map(stableStringify).join(",") + "]";
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
        const v = record[key];
        if (v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        parts.push(JSON.stringify(key) + ":" + stableStringify(v));
    }
    return "{" + parts.join(",") + "}";
}

/** Hash a single normalized action. */
export function actionHash(action: Action): string {
    const normalized = normalizeActionCompare(action);
    return hashHex(stableStringify(normalized));
}

/** Hash a single normalized condition. */
export function conditionHash(cond: Condition): string {
    const normalized = normalizeConditionCompare(cond);
    return hashHex(stableStringify(normalized));
}

/** Hash an entire normalized action list (used for top-level / nested lists). */
export function actionListHash(actions: readonly Action[]): string {
    const parts = actions.map((a) => stableStringify(normalizeActionCompare(a)));
    return hashHex("[" + parts.join(",") + "]");
}

/** Hash an entire normalized condition list. */
export function conditionListHash(conditions: readonly Condition[]): string {
    const parts = conditions.map((c) =>
        stableStringify(normalizeConditionCompare(c))
    );
    return hashHex("[" + parts.join(",") + "]");
}

/**
 * Per-slot hashes for an action list. These are written into the cache
 * so a future trust-mode can verify a single sub-tree without a deep
 * structural comparison.
 */
export function perSlotActionHashes(actions: readonly Action[]): string[] {
    return actions.map(actionHash);
}

/**
 * Walk an action list and emit `{ <path>: hashes[] }` for every reachable
 * action list (top-level + every nested ifActions/elseActions/RANDOM body).
 *
 * Path syntax matches the cache schema in the design doc:
 *   "actions"
 *   "actions[3].ifActions"
 *   "actions[3].elseActions"
 *   "actions[3].ifActions[1].actions"   // nested RANDOM inside an IF branch
 */
function collectActionListHashes(
    out: Record<string, string[]>,
    path: string,
    actions: readonly Action[]
): void {
    out[path] = perSlotActionHashes(actions);
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (action.type === "CONDITIONAL") {
            out[`${path}[${i}].conditions`] = action.conditions.map(conditionHash);
            collectActionListHashes(out, `${path}[${i}].ifActions`, action.ifActions);
            collectActionListHashes(out, `${path}[${i}].elseActions`, action.elseActions);
        } else if (action.type === "RANDOM") {
            collectActionListHashes(out, `${path}[${i}].actions`, action.actions);
        }
    }
}

/**
 * Build the `lists` map for a knowledge entry. The top-level key depends
 * on which action lists the importable exposes (functions/events have one,
 * regions have up to two, items have up to two).
 */
export function listHashes(importable: Importable): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    switch (importable.type) {
        case "FUNCTION":
        case "EVENT":
            collectActionListHashes(out, "actions", importable.actions);
            break;
        case "REGION":
            if (importable.onEnterActions) {
                collectActionListHashes(out, "onEnterActions", importable.onEnterActions);
            }
            if (importable.onExitActions) {
                collectActionListHashes(out, "onExitActions", importable.onExitActions);
            }
            break;
        case "ITEM":
            if (importable.leftClickActions) {
                collectActionListHashes(out, "leftClickActions", importable.leftClickActions);
            }
            if (importable.rightClickActions) {
                collectActionListHashes(out, "rightClickActions", importable.rightClickActions);
            }
            break;
        case "NPC":
            if (importable.leftClickActions) {
                collectActionListHashes(out, "leftClickActions", importable.leftClickActions);
            }
            if (importable.rightClickActions) {
                collectActionListHashes(out, "rightClickActions", importable.rightClickActions);
            }
            break;
        case "MENU":
            for (let i = 0; i < importable.slots.length; i++) {
                const slot = importable.slots[i];
                if (slot.actions && slot.actions.length > 0) {
                    collectActionListHashes(
                        out,
                        `slots[${i}].actions`,
                        slot.actions
                    );
                }
            }
            break;
    }
    return out;
}

/**
 * Hash the entire importable. Caller-facing canonical fingerprint —
 * this is what the future trust-mode compares first to decide whether
 * a deep equality check is needed at all.
 */
export function importableHash(importable: Importable): string {
    // Walk into known list-bearing fields with the action normalizer so
    // the surrounding importable record gets canonicalized while its
    // action lists pick up the same default-stripping the importer's
    // diff sees. Anything else is stringified verbatim by stableStringify.
    const canonical: Record<string, unknown> = {};
    for (const key of Object.keys(importable).sort()) {
        const value = (importable as unknown as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        if (
            (key === "actions" ||
                key === "ifActions" ||
                key === "elseActions" ||
                key === "onEnterActions" ||
                key === "onExitActions" ||
                key === "leftClickActions" ||
                key === "rightClickActions") &&
            Array.isArray(value)
        ) {
            canonical[key] = (value as Action[]).map((a) => normalizeActionCompare(a));
        } else if (
            importable.type === "MENU" &&
            key === "slots" &&
            Array.isArray(value)
        ) {
            // Menu slots embed action lists; normalize them so the hash
            // tracks the same canonical form the diff sees.
            canonical[key] = (value as Array<Record<string, unknown>>).map(
                (slot) => normalizeMenuSlotForHash(slot)
            );
        } else {
            canonical[key] = value;
        }
    }
    return hashHex(stableStringify(canonical));
}

function normalizeMenuSlotForHash(
    slot: Record<string, unknown>
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(slot).sort()) {
        const value = slot[key];
        if (value === undefined) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        if (key === "actions" && Array.isArray(value)) {
            result[key] = (value as Action[]).map((a) => normalizeActionCompare(a));
        } else {
            result[key] = value;
        }
    }
    return result;
}
