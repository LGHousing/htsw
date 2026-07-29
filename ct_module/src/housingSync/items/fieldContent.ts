import * as htsw from "htsw";
import type { Action, Condition, Importable } from "htsw/types";

import { visitItemReferences } from "../../importables/items/dependencies";
import type { CapturedItem } from "../../importables/items/captureRegistry";
import type { ProjectItemIndex } from "../../importables/items/projectItems";
import {
    getActionScalarLoreFields,
    getChildListFields,
} from "../fields/actionMappings";
import { getConditionScalarLoreFields } from "../fields/conditionMappings";
import { canonicalItemShellTagKey } from "./itemNbt";
import type { TagLike } from "./itemTag";

export type ItemFieldContent = (
    owner: Action | Condition,
    property: string
) => string | undefined;

export function sourceItemFieldContent(
    importable: Importable,
    projectItems: ProjectItemIndex
): ItemFieldContent {
    const fields = new WeakMap<Action | Condition, Map<string, string>>();
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
        ownerFields.set(use.property, canonicalItemShellTagKey(entry.nbt));
    });
    return (owner, property) => fields.get(owner)?.get(property);
}

export function capturedItemFieldContent(
    importable: Importable,
    captures: readonly CapturedItem[]
): ItemFieldContent {
    const capturesByName = new Map<string, CapturedItem>();
    for (const item of captures) capturesByName.set(item.name, item);
    const fields = new WeakMap<Action | Condition, Map<string, string>>();
    visitItemReferences(importable, (use) => {
        const captured = capturesByName.get(use.itemName);
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
        ownerFields.set(use.property, canonicalItemShellTagKey(tag));
    });
    return (owner, property) => fields.get(owner)?.get(property);
}

export function cloneActionsWithItemFieldContent(
    source: ReadonlyArray<Action | null>,
    sourceItemContent: ItemFieldContent | undefined
): {
    actions: Array<Action | null>;
    itemContent?: ItemFieldContent;
} {
    const actions = source.map((action) =>
        action === null
            ? null
            : (JSON.parse(JSON.stringify(action)) as Action)
    );
    if (sourceItemContent === undefined) return { actions };

    const fields = new WeakMap<Action | Condition, Map<string, string>>();
    const copyFields = (
        sourceOwner: Action | Condition,
        targetOwner: Action | Condition,
        specs: readonly { prop: string; kind?: string }[]
    ): void => {
        for (const spec of specs) {
            if (spec.kind !== "item") continue;
            const item = sourceItemContent(sourceOwner, spec.prop);
            if (item === undefined) continue;
            let ownerFields = fields.get(targetOwner);
            if (ownerFields === undefined) {
                ownerFields = new Map();
                fields.set(targetOwner, ownerFields);
            }
            ownerFields.set(spec.prop, item);
        }
    };
    const copyConditions = (
        sourceConditions: ReadonlyArray<Condition | null>,
        targetConditions: ReadonlyArray<Condition | null>
    ): void => {
        const length = Math.min(sourceConditions.length, targetConditions.length);
        for (let i = 0; i < length; i++) {
            const sourceCondition = sourceConditions[i];
            const targetCondition = targetConditions[i];
            if (sourceCondition === null || targetCondition === null) continue;
            copyFields(
                sourceCondition,
                targetCondition,
                getConditionScalarLoreFields(sourceCondition.type)
            );
        }
    };
    const copyActions = (
        sourceActions: ReadonlyArray<Action | null>,
        targetActions: ReadonlyArray<Action | null>
    ): void => {
        const length = Math.min(sourceActions.length, targetActions.length);
        for (let i = 0; i < length; i++) {
            const sourceAction = sourceActions[i];
            const targetAction = targetActions[i];
            if (sourceAction === null || targetAction === null) continue;
            copyFields(
                sourceAction,
                targetAction,
                getActionScalarLoreFields(sourceAction.type)
            );
            const sourceRecord = sourceAction as unknown as Record<string, unknown>;
            const targetRecord = targetAction as unknown as Record<string, unknown>;
            for (const childField of getChildListFields(sourceAction.type)) {
                const sourceChildren = sourceRecord[childField.prop];
                const targetChildren = targetRecord[childField.prop];
                if (!Array.isArray(sourceChildren) || !Array.isArray(targetChildren)) {
                    continue;
                }
                if (childField.kind === "conditionList") {
                    copyConditions(
                        sourceChildren as Array<Condition | null>,
                        targetChildren as Array<Condition | null>
                    );
                } else {
                    copyActions(
                        sourceChildren as Array<Action | null>,
                        targetChildren as Array<Action | null>
                    );
                }
            }
        }
    };
    copyActions(source, actions);
    return {
        actions,
        itemContent: (owner, property) => fields.get(owner)?.get(property),
    };
}
