import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { resolveItemReference } from "../../items";
import type { Action, Condition, Importable, ImportableItem } from "../../types";
import { visitActionTrees } from "../actionTree";

export function checkItems(
    gcx: GlobalCtxt,
    checkableImportables: Importable[] = gcx.importables,
) {
    const items = collectItems(gcx);
    checkItemReferences(gcx, items, checkableImportables);
}

function collectItems(gcx: GlobalCtxt): ImportableItem[] {
    return gcx.importables.filter(
        (importable): importable is ImportableItem => importable.type === "ITEM"
    );
}

function checkItemReferences(
    gcx: GlobalCtxt,
    items: ImportableItem[],
    importables: Importable[],
): void {
    const itemNames = new Map(items.map((item) => [item.name, item]));

    visitActionTrees(importables, {
        action: action => checkAction(gcx, itemNames, action),
        conditions: conditions => checkConditions(gcx, itemNames, conditions),
    });
}

function checkAction(
    gcx: GlobalCtxt,
    itemNames: ReadonlyMap<string, ImportableItem>,
    action: Action,
): void {
    if (
        action.type === "GIVE_ITEM" ||
        action.type === "REMOVE_ITEM" ||
        action.type === "DROP_ITEM"
    ) {
        if (action.itemName !== undefined) {
            checkItemReference(gcx, itemNames, action, action.itemName);
        }
    }
}

function checkConditions(
    gcx: GlobalCtxt,
    itemNames: ReadonlyMap<string, ImportableItem>,
    conditions: readonly Condition[]
): void {
    for (const condition of conditions) {
        if (
            condition.type === "REQUIRE_ITEM" ||
            condition.type === "BLOCK_TYPE" ||
            condition.type === "IS_ITEM"
        ) {
            if (condition.itemName !== undefined) {
                checkItemReference(gcx, itemNames, condition, condition.itemName);
            }
        }
    }
}

function checkItemReference(
    gcx: GlobalCtxt,
    itemNames: ReadonlyMap<string, ImportableItem>,
    node: Action | Condition,
    itemName: string
): void {
    const resolved = resolveItemReference(gcx, itemNames, node, itemName);
    if (resolved !== undefined) {
        return;
    }

    if (itemName.toLowerCase().endsWith(".snbt")) {
        return;
    }

    if (itemName.startsWith("minecraft:")) {
        gcx.addDiagnostic(
            Diagnostic.error(`Unknown vanilla item '${itemName}'`)
                .addPrimarySpan(gcx.spans.getField(node as { itemName: string }, "itemName"))
                .addSubDiagnostic(
                    Diagnostic.help(
                        "Vanilla item ids must match a known minecraft: item id."
                    )
                )
        );
        return;
    }

    gcx.addDiagnostic(
        Diagnostic.error(`Unknown item '${itemName}'`)
            .addPrimarySpan(gcx.spans.getField(node as { itemName: string }, "itemName"))
            .addSubDiagnostic(
                Diagnostic.help(
                    "Item fields must match a top-level items[].name, a known minecraft: item id, or a direct .snbt path."
                )
            )
    );
}
