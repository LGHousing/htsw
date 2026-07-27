import * as htsw from "htsw";
import type { Action, Condition, Importable } from "htsw/types";

import { visitItemReferences } from "../../importables/items/dependencies";
import type { CapturedItem } from "../../importables/items/captureRegistry";
import type { ProjectItemIndex } from "../../importables/items/projectItems";
import { getActionScalarLoreFields } from "../fields/actionMappings";
import { getConditionScalarLoreFields } from "../fields/conditionMappings";
import { canonicalItemShellTagKey } from "./itemNbt";
import type { TagLike } from "./itemTag";

export type CanonicalItemField = {
    key: string;
    tag: TagLike;
};

export type ItemFieldContent = (
    owner: Action | Condition,
    property: string
) => CanonicalItemField | undefined;

export type ItemFieldContentSnapshot = Record<string, CanonicalItemField>;

export function sourceItemFieldContent(
    importable: Importable,
    projectItems: ProjectItemIndex
): ItemFieldContent {
    const fields = new WeakMap<Action | Condition, Map<string, CanonicalItemField>>();
    visitItemReferences(importable, (use) => {
        const entry =
            projectItems.resolveFromSourcePath(
                use.itemName,
                use.sourcePath,
                use.owner
            ) ?? projectItems.resolve(use.itemName, use.owner);
        if (entry === undefined) return;
        let ownerFields = fields.get(use.owner);
        if (ownerFields === undefined) {
            ownerFields = new Map();
            fields.set(use.owner, ownerFields);
        }
        ownerFields.set(use.property, {
            key: canonicalItemShellTagKey(entry.nbt),
            tag: entry.nbt,
        });
    });
    return (owner, property) => fields.get(owner)?.get(property);
}

export function capturedItemFieldContent(
    importable: Importable,
    captures: ReadonlyMap<string, CapturedItem>
): ItemFieldContent {
    const fields = new WeakMap<Action | Condition, Map<string, CanonicalItemField>>();
    visitItemReferences(importable, (use) => {
        const captured = captures.get(use.itemName);
        if (captured === undefined) return;
        const tag =
            captured.snbt === ""
                ? captured.canonicalTagKey === undefined
                    ? undefined
                    : (JSON.parse(captured.canonicalTagKey) as TagLike)
                : htsw.nbt.parseSnbtText(captured.snbt);
        if (tag === undefined) return;
        let ownerFields = fields.get(use.owner);
        if (ownerFields === undefined) {
            ownerFields = new Map();
            fields.set(use.owner, ownerFields);
        }
        ownerFields.set(use.property, {
            key: canonicalItemShellTagKey(tag),
            tag,
        });
    });
    return (owner, property) => fields.get(owner)?.get(property);
}

export function itemFieldContentSnapshot(
    actions: readonly Action[],
    itemContent: ItemFieldContent
): ItemFieldContentSnapshot {
    const snapshot: ItemFieldContentSnapshot = {};
    const addFields = (owner: Action | Condition, fields: readonly { prop: string; kind?: string }[]) => {
        for (const field of fields) {
            if (field.kind !== "item") continue;
            const name = (owner as Record<string, unknown>)[field.prop];
            const item = itemContent(owner, field.prop);
            if (typeof name === "string" && item !== undefined) {
                snapshot[name] = item;
            }
        }
    };
    const visitConditions = (conditions: readonly Condition[]) => {
        for (const condition of conditions) {
            addFields(condition, getConditionScalarLoreFields(condition.type));
        }
    };
    const visitActions = (list: readonly Action[]) => {
        for (const action of list) {
            addFields(action, getActionScalarLoreFields(action.type));
            if (action.type === "CONDITIONAL") {
                visitConditions(action.conditions);
                visitActions(action.ifActions);
                visitActions(action.elseActions);
            } else if (action.type === "RANDOM") {
                visitActions(action.actions);
            }
        }
    };
    visitActions(actions);
    return snapshot;
}

export function itemFieldContentFromSnapshot(
    snapshot: ItemFieldContentSnapshot | undefined
): ItemFieldContent | undefined {
    if (snapshot === undefined) return undefined;
    return (owner, property) => {
        const name = (owner as Record<string, unknown>)[property];
        return typeof name === "string" ? snapshot[name] : undefined;
    };
}
