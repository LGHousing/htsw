import type { Action, Bounds, Condition, FunctionIcon, Importable } from "htsw/types";

import { cyrb53, stableStringify } from "../utils/helpers";
import { canonicalStringify } from "../housingSync/fields/compare";
import {
    type TagLike,
    canonicalItemTag,
} from "../housingSync/fields/itemTagCanonical";

/**
 * Importable-cache hashing.
 *
 * The exporter writes a cache entry after a fresh GUI read; the importer
 * writes one after every successful sync. Both must produce **identical**
 * hashes for identical importables — otherwise a later run would think the
 * importable had changed when it hadn't, and redo work it could have skipped.
 *
 * To keep that guarantee, every value flows through the same
 * `normalizeActionCompare` / `normalizeConditionCompare` the importer uses
 * for its diff equality checks. As long as those two normalizers stay
 * equivalent (they're the same function via `normalizeValue`), the hash and
 * the diff comparator cannot disagree about whether two importables match.
 */

/** Hex-encoded 53-bit cyrb53 digest, prefixed with "0x" for clarity in JSON. */
function hashHex(input: string): string {
    return "0x" + cyrb53(input).toString(16);
}

/** Hash a single normalized action. */
export function actionHash(action: Action): string {
    return hashHex(canonicalStringify(action));
}

/** Hash a single normalized condition. */
export function conditionHash(cond: Condition): string {
    return hashHex(canonicalStringify(cond));
}/**
 * One hash per action in the list. Stored in the cache so a single action
 * list can later be checked for changes by comparing hashes, without walking
 * and comparing the whole action tree.
 */
function perSlotActionHashes(actions: readonly Action[]): string[] {
    return actions.map(actionHash);
}

/**
 * Walk an action list and emit `{ <path>: hashes[] }` for every reachable
 * action list (top-level + every nested ifActions/elseActions/RANDOM body).
 *
 * Each key is a dotted path locating that list within the importable:
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
 * Build the `lists` map for an importable cache entry. The top-level key depends
 * on which action lists the importable exposes (functions/events have one,
 * regions have up to two, items have up to two).
 */
export function listHashes(importable: Importable): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    switch (importable.type) {
        case "FUNCTION":
        case "EVENT":
        case "COMMAND":
            collectActionListHashes(out, "actions", importable.actions ?? []);
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
                collectActionListHashes(
                    out,
                    "leftClickActions",
                    importable.leftClickActions
                );
            }
            if (importable.rightClickActions) {
                collectActionListHashes(
                    out,
                    "rightClickActions",
                    importable.rightClickActions
                );
            }
            break;
        case "NPC":
            if (importable.leftClickActions) {
                collectActionListHashes(
                    out,
                    "leftClickActions",
                    importable.leftClickActions
                );
            }
            if (importable.rightClickActions) {
                collectActionListHashes(
                    out,
                    "rightClickActions",
                    importable.rightClickActions
                );
            }
            break;
        case "MENU":
            for (let i = 0; i < importable.slots.length; i++) {
                const slot = importable.slots[i];
                if (slot.actions && slot.actions.length > 0) {
                    collectActionListHashes(out, `slots[${i}].actions`, slot.actions);
                }
            }
            break;
    }
    return out;
}

const DEFAULT_FUNCTION_ICON_CANONICAL = iconCanonical({ item: "minecraft:map" });

// Parser-stamped file locations (which file the content was parsed FROM),
// not Housing content. House reads never set them, and parse-side and
// house-side hashes must stay equal for identical content.
const PARSE_PATH_KEYS = new Set([
    "sourcePath",
    "actionsPath",
    "nbtPath",
    "onEnterActionsPath",
    "onExitActionsPath",
    "leftClickActionsPath",
    "rightClickActionsPath",
]);

export type ImportableCanonicalPart = { key: string; serialized: string };

/**
 * The per-key canonical serializations `importableHash` is built from —
 * exposed so diagnostics (the live test suite) can name WHICH key two
 * importables disagree on instead of reporting an opaque hash mismatch.
 */
export function importableCanonicalParts(
    importable: Importable
): ImportableCanonicalPart[] {
    const subject =
        importable.type === "COMMAND" ? commandCanonical(importable) : importable;
    const keys = Object.keys(subject).sort();
    const parts: ImportableCanonicalPart[] = [];
    for (let ki = 0; ki < keys.length; ki++) {
        const key = keys[ki];
        if (PARSE_PATH_KEYS.has(key)) continue;
        const value = (subject as unknown as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (Array.isArray(value) && value.length === 0) continue;

        let serialized: string;
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
            serialized = actionListCanonical(value as Action[]);
        } else if (
            importable.type === "MENU" &&
            key === "slots" &&
            Array.isArray(value)
        ) {
            const slotParts: string[] = [];
            for (let si = 0; si < value.length; si++) {
                slotParts.push(menuSlotCanonical(value[si] as Record<string, unknown>));
            }
            serialized = "[" + slotParts.join(",") + "]";
        } else if (
            importable.type === "REGION" &&
            key === "bounds" &&
            value !== null &&
            typeof value === "object"
        ) {
            serialized = boundsCanonical(value as Bounds);
        } else if (key === "icon" && value !== null && typeof value === "object") {
            serialized = iconCanonical(value as FunctionIcon);
            // Housing assigns every function a plain map icon at creation, so a
            // live read of a function whose source declares no icon reports
            // {item:"minecraft:map"}; treat the default icon as icon-less so
            // both sides hash alike.
            if (serialized === DEFAULT_FUNCTION_ICON_CANONICAL) continue;
        } else {
            serialized = stableStringify(value);
        }

        parts.push({ key, serialized });
    }
    return parts;
}

/**
 * Hash the entire importable into one fingerprint. A later run compares this
 * first: if it matches the cached value, the importable is unchanged and no
 * action-by-action comparison is needed.
 */
export function importableHash(importable: Importable): string {
    const parts = importableCanonicalParts(importable);
    const joined: string[] = [];
    for (let i = 0; i < parts.length; i++) {
        joined.push(JSON.stringify(parts[i].key) + ":" + parts[i].serialized);
    }
    const str = "{" + joined.join(",") + "}";
    return hashHex(str);
}

// Housing normalizes a region's corners to per-axis min/max, so any corner
// pairing that spans the same box must hash alike.
function boundsCanonical(bounds: Bounds): string {
    const lo = {
        x: Math.min(bounds.from.x, bounds.to.x),
        y: Math.min(bounds.from.y, bounds.to.y),
        z: Math.min(bounds.from.z, bounds.to.z),
    };
    const hi = {
        x: Math.max(bounds.from.x, bounds.to.x),
        y: Math.max(bounds.from.y, bounds.to.y),
        z: Math.max(bounds.from.z, bounds.to.z),
    };
    return stableStringify({ from: lo, to: hi });
}

// A live read always returns concrete command settings, while an import.json
// may omit them; drop Housing's defaults (mode Self, requiredPriority 0,
// listed true) so both sides hash alike.
function commandCanonical(command: Importable): Importable {
    const norm: Record<string, unknown> = { ...command };
    if (norm.mode === "Self") delete norm.mode;
    if (norm.requiredPriority === 0) delete norm.requiredPriority;
    if (norm.listed === true) delete norm.listed;
    return norm as unknown as Importable;
}

// Normalize in place rather than rebuilding from a named field list: spreading
// the whole icon keeps every field in the hash (a rebuild silently drops any
// field it doesn't name); then drop the optional defaults a live read omits so
// `{item}` and `{item, count: 1}` hash alike. The item id needs no normalization
// — both the loader and the live read already emit `minecraft:<lowercase>`.
function iconCanonical(icon: FunctionIcon): string {
    const norm: Record<string, unknown> = { ...icon };
    if (norm.count === 1) delete norm.count;
    if (norm.enchanted !== true) delete norm.enchanted;
    return stableStringify(norm);
}

function actionListCanonical(actions: readonly Action[]): string {
    const parts: string[] = [];
    for (let i = 0; i < actions.length; i++) {
        parts.push(canonicalStringify(actions[i]));
    }
    return "[" + parts.join(",") + "]";
}

/**
 * Content key for an item's click actions — used to cache/share its housing
 * `interact_data`. Same normalization as `importableHash`, so two items with
 * the same actions collide on one cached blob.
 */
export function clickActionsHash(
    left: readonly Action[] | undefined,
    right: readonly Action[] | undefined
): string {
    const key =
        actionListCanonical(left ?? []) + " " + actionListCanonical(right ?? []);
    return String(cyrb53(key));
}

export function menuSlotCanonical(slot: Record<string, unknown>): string {
    const keys = Object.keys(slot).sort();
    const parts: string[] = [];
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (PARSE_PATH_KEYS.has(key)) continue;
        const value = slot[key];
        if (value === undefined) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        let serialized: string;
        if (key === "actions" && Array.isArray(value)) {
            serialized = actionListCanonical(value as Action[]);
        } else if (key === "nbt") {
            serialized = menuSlotNbtCanonical(value);
        } else {
            serialized = stableStringify(value);
        }
        parts.push(JSON.stringify(key) + ":" + serialized);
    }
    return "{" + parts.join(",") + "}";
}

// A live menu-slot read hands back vanilla defaults and Housing noise a
// source snbt never writes; both sides go through the ONE shared item
// canonicalization (fields/itemTagCanonical.ts) so this hash and the
// import-time capture matching cannot disagree about item identity.
function menuSlotNbtCanonical(nbt: unknown): string {
    if (
        nbt === null ||
        typeof nbt !== "object" ||
        (nbt as { type?: unknown }).type !== "compound"
    ) {
        return stableStringify(nbt);
    }
    return stableStringify(canonicalItemTag(nbt as TagLike));
}
