import type { Action, Condition } from "htsw/types";

import {
    actionsEqual,
    conditionCompareKey,
} from "../../src/housingSync/actions/comparison";
import type {
    ActionListOperation,
    CurrentActionListEntry,
} from "../../src/housingSync/actions/diff/types";
import type { Observed } from "../../src/housingSync/observedActions";

type Entry = { entryId: number; action: Observed | null };

export function applyPlan(
    current: readonly CurrentActionListEntry[],
    operations: readonly ActionListOperation[]
): Array<Observed | null> {
    const entries: Entry[] = current.map(({ entryId, action }) => ({ entryId, action }));
    const deletes = operations
        .filter(
            (op): op is Extract<ActionListOperation, { kind: "delete" }> =>
                op.kind === "delete"
        )
        .sort((a, b) => b.fromIndex - a.fromIndex);
    const edits = operations.filter(
        (op): op is Extract<ActionListOperation, { kind: "edit" }> => op.kind === "edit"
    );
    const moves = operations
        .filter(
            (op): op is Extract<ActionListOperation, { kind: "move" }> =>
                op.kind === "move"
        )
        .sort((a, b) => a.toIndex - b.toIndex);
    const adds = operations
        .filter(
            (op): op is Extract<ActionListOperation, { kind: "add" }> => op.kind === "add"
        )
        .sort((a, b) => a.toIndex - b.toIndex);

    for (const op of deletes) {
        const index = entries.findIndex((entry) => entry.entryId === op.entryId);
        if (index !== -1) entries.splice(index, 1);
    }
    for (const op of edits) {
        const entry = entries.find((candidate) => candidate.entryId === op.entryId);
        if (entry) entry.action = op.desired;
    }
    for (const op of moves) {
        const fromIndex = entries.findIndex((entry) => entry.entryId === op.entryId);
        if (fromIndex === -1) continue;
        const [entry] = entries.splice(fromIndex, 1);
        entries.splice(op.toIndex, 0, entry);
    }
    let nextEntryId =
        current.reduce((max, entry) => Math.max(max, entry.entryId), -1) + 1;
    for (const op of adds) {
        entries.push({ entryId: nextEntryId++, action: op.desired });
        const [entry] = entries.splice(entries.length - 1, 1);
        entries.splice(op.toIndex, 0, entry);
    }
    return entries.map((entry) => entry.action);
}

export function actionListsEqual(
    actual: readonly (Observed | null)[],
    desired: readonly Action[]
): boolean {
    return (
        actual.length === desired.length &&
        actual.every((action, index) =>
            action === null
                ? false
                : actionsEqual(
                      normalizeConditionOrder(action) as Observed,
                      normalizeConditionOrder(desired[index]) as Action
                  )
        )
    );
}

function normalizeConditionOrder(value: unknown): unknown {
    if (Array.isArray(value)) {
        return (value as unknown[]).map(normalizeConditionOrder);
    }
    if (typeof value !== "object" || value === null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        const normalized = normalizeConditionOrder(child);
        if (key === "conditions" && Array.isArray(normalized)) {
            const conditions = normalized as Array<
                Observed<Condition> | Condition | null
            >;
            out[key] = [...conditions].sort((a, b) =>
                conditionCompareKey(a).localeCompare(conditionCompareKey(b))
            );
        } else {
            out[key] = normalized;
        }
    }
    return out;
}
