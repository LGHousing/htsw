import type { Action, Bounds, Condition, FunctionIcon, Importable } from "htsw/types";

import { stableStringify } from "../utils/helpers";
import { hashHex } from "../utils/hash";
import {
    actionCompareKey,
    actionListCompareKey,
    conditionCompareKey,
} from "../housingSync/actions/comparison";
import { commandCompareShape } from "../importables/commands/settings";
import { functionIconCompareKey } from "../importables/functions/iconComparison";
import { menuSlotCompareKey } from "../importables/menus/slotComparison";
import { regionBoundsCompareKey } from "../importables/regions/bounds";
import { actionListsOfImportable } from "./actionLists";

/**
 * Importable-cache hashing.
 *
 * The exporter writes a cache entry after a fresh GUI read; the importer
 * writes one after every successful sync. Both must produce **identical**
 * hashes for identical importables — otherwise a later run would think the
 * importable had changed when it hadn't, and redo work it could have skipped.
 *
 * Housing-normalized fields use comparison keys owned by their importable
 * domains. This remains a cache fingerprint: applying an importable can also
 * depend on directional rules and item-dependency snapshots that do not belong
 * in this hash.
 */

/** Hash a single normalized action. */
export function actionHash(action: Action): string {
    return hashHex(actionCompareKey(action));
}

/** Hash a single normalized condition. */
export function conditionHash(cond: Condition): string {
    return hashHex(conditionCompareKey(cond));
}

/**
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
    for (const list of actionListsOfImportable(importable)) {
        collectActionListHashes(out, list.basePath, list.actions);
    }
    return out;
}

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
        importable.type === "COMMAND" ? commandCompareShape(importable) : importable;
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
            serialized = actionListCompareKey(value as Action[]);
        } else if (
            importable.type === "MENU" &&
            key === "slots" &&
            Array.isArray(value)
        ) {
            // A menu has no inherent slot order: Housing keys slots by number
            // and a house read returns them sorted by id. Sort before joining
            // so an import.json declaring slots in any order hashes identically
            // to the same menu read back from the house — otherwise the menu
            // never counts as unchanged and trust mode re-diffs it every run.
            const sortedSlots = (value as Record<string, unknown>[])
                .slice()
                .sort((a, b) => Number(a.slot) - Number(b.slot));
            const slotParts: string[] = [];
            for (let si = 0; si < sortedSlots.length; si++) {
                slotParts.push(menuSlotCompareKey(sortedSlots[si]));
            }
            serialized = "[" + slotParts.join(",") + "]";
        } else if (
            importable.type === "REGION" &&
            key === "bounds" &&
            value !== null &&
            typeof value === "object"
        ) {
            serialized = regionBoundsCompareKey(value as Bounds);
        } else if (
            importable.type === "FUNCTION" &&
            key === "icon" &&
            value !== null &&
            typeof value === "object"
        ) {
            const iconKey = functionIconCompareKey(value as FunctionIcon);
            // Housing assigns every function a plain map icon at creation, so a
            // live read of a function whose source declares no icon reports
            // {item:"minecraft:map"}; treat the default icon as icon-less so
            // both sides hash alike.
            if (iconKey === null) continue;
            serialized = iconKey;
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
