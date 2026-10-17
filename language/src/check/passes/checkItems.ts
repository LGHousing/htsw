import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import {
    ITEM_COUNT_MAX,
    ITEM_COUNT_MIN,
    isValidItemCount,
    parseItemReferenceParts,
    resolveItemReference,
} from "../../items";
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
    const { base, count } = parseItemReferenceParts(itemName);
    if (count !== undefined && !isValidItemCount(count)) {
        gcx.addDiagnostic(
            Diagnostic.error(
                `Stack count '${count}' is out of range in item '${itemName}'`
            )
                .addPrimarySpan(
                    gcx.spans.getField(node as { itemName: string }, "itemName")
                )
                .addSubDiagnostic(
                    Diagnostic.help(
                        `A '@<count>' suffix must be between ${ITEM_COUNT_MIN} and ${ITEM_COUNT_MAX}.`
                    )
                )
        );
        return;
    }

    const resolved = resolveItemReference(gcx, itemNames, node, itemName);
    if (resolved !== undefined) {
        return;
    }

    if (base.toLowerCase().endsWith(".snbt")) {
        return;
    }

    if (base.startsWith("minecraft:")) {
        gcx.addDiagnostic(
            Diagnostic.error(`Unknown vanilla item '${base}'`)
                .addPrimarySpan(gcx.spans.getField(node as { itemName: string }, "itemName"))
                .addSubDiagnostic(
                    Diagnostic.help(
                        "Vanilla item ids must match a known minecraft: item id."
                    )
                )
        );
        return;
    }

    const diagnostic = Diagnostic.error(`Unknown item '${base}'`)
        .addPrimarySpan(gcx.spans.getField(node as { itemName: string }, "itemName"))
        .addSubDiagnostic(
            Diagnostic.help(
                "Item fields must match a top-level items[].name, a known minecraft: item id or damage-variant name, or a direct .snbt path."
            )
        );

    // `@` is reserved for the stack-count suffix and rejected in item names, so
    // one that survived the split is a malformed count rather than a real name.
    if (base.indexOf("@") >= 0) {
        diagnostic.addSubDiagnostic(
            Diagnostic.help(
                `To set a stack size, suffix the name with '@' and a count between ${ITEM_COUNT_MIN} and ${ITEM_COUNT_MAX}, as in 'oak_log@8'.`
            )
        );
    }

    gcx.addDiagnostic(diagnostic);
}
