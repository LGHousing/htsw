import type { Action, Importable } from "htsw/types";

import { importableIdentity } from "../identity";
import type { ImportConflict } from "./conflicts";

export type ImportConflictResolution = {
    accepted: ImportConflict[];
    skipped: ImportConflict[];
};

export function conflictIdentifier(conflict: ImportConflict): string {
    return `${conflict.type}:${conflict.identity}:${conflict.basePath}`;
}

function conflictImportableIdentifier(conflict: ImportConflict): string {
    return `${conflict.type}:${conflict.identity}`;
}

export function resolveImportConflicts(
    conflicts: readonly ImportConflict[],
    accepts: readonly string[]
): ImportConflictResolution {
    const accepted: ImportConflict[] = [];
    const acceptedKeys = new Set<string>();
    for (const identifier of accepts) {
        const matches = conflicts.filter(
            (conflict) =>
                conflictImportableIdentifier(conflict) === identifier ||
                conflictIdentifier(conflict) === identifier
        );
        if (matches.length === 0) {
            const actual = conflicts.map(conflictIdentifier).join(", ");
            throw new Error(
                `--accept did not match any conflicted list: ${identifier}` +
                    (actual.length === 0 ? "" : ` (conflicts: ${actual})`)
            );
        }
        for (const conflict of matches) acceptedKeys.add(conflictIdentifier(conflict));
    }
    const skipped: ImportConflict[] = [];
    for (const conflict of conflicts) {
        if (acceptedKeys.has(conflictIdentifier(conflict))) accepted.push(conflict);
        else skipped.push(conflict);
    }
    return { accepted, skipped };
}

export function importableWithSkippedConflictLists(
    desired: Importable,
    skipped: readonly ImportConflict[],
    observedLists: ReadonlyMap<string, readonly Action[]>
): Importable {
    if (skipped.length === 0) return desired;
    const result = JSON.parse(JSON.stringify(desired)) as Importable;
    for (const conflict of skipped) {
        if (
            conflict.type !== desired.type ||
            conflict.identity !== importableIdentity(desired)
        ) {
            continue;
        }
        const actions = observedLists.get(conflictIdentifier(conflict));
        if (actions !== undefined) setActionList(result, conflict.basePath, actions);
    }
    return result;
}

function setActionList(
    importable: Importable,
    basePath: string,
    actions: readonly Action[]
): void {
    const cloned = JSON.parse(JSON.stringify(actions)) as Action[];
    if (
        (importable.type === "FUNCTION" ||
            importable.type === "EVENT" ||
            importable.type === "COMMAND") &&
        basePath === "actions"
    ) {
        importable.actions = cloned;
        return;
    }
    if (importable.type === "REGION") {
        if (basePath === "onEnterActions") importable.onEnterActions = cloned;
        if (basePath === "onExitActions") importable.onExitActions = cloned;
        return;
    }
    if (importable.type === "ITEM" || importable.type === "NPC") {
        if (basePath === "leftClickActions") importable.leftClickActions = cloned;
        if (basePath === "rightClickActions") importable.rightClickActions = cloned;
        return;
    }
    if (importable.type === "MENU") {
        const match = basePath.match(/^slots\[(\d+)\]\.actions$/);
        if (match !== null) {
            importable.slots[Number(match[1])].actions = cloned;
        }
    }
}
