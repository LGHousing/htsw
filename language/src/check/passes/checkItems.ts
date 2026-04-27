import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { resolveItemReference } from "../../items";
import type { Action, Condition, ImportableItem } from "../../types";

export function checkItems(gcx: GlobalCtxt) {
    const items = collectItems(gcx);
    checkDuplicateItemNames(gcx, items);
    checkItemReferences(gcx, items);
}

function collectItems(gcx: GlobalCtxt): ImportableItem[] {
    return gcx.importables.filter(
        (importable): importable is ImportableItem => importable.type === "ITEM"
    );
}

function checkDuplicateItemNames(gcx: GlobalCtxt, items: ImportableItem[]): void {
    const seen: Record<string, ImportableItem> = {};

    for (const item of items) {
        const existing = seen[item.name];
        if (existing !== undefined) {
            gcx.addDiagnostic(
                Diagnostic.error(`Duplicate item name '${item.name}'`)
                    .addPrimarySpan(
                        gcx.spans.getField(item, "name"),
                        "duplicate item name"
                    )
                    .addSecondarySpan(
                        gcx.spans.getField(existing, "name"),
                        "first item with this name"
                    )
                    .addSubDiagnostic(
                        Diagnostic.help(
                            "Item references use top-level items[].name, so item names must be unique."
                        )
                    )
            );
            continue;
        }

        seen[item.name] = item;
    }
}

function checkItemReferences(gcx: GlobalCtxt, items: ImportableItem[]): void {
    const itemNames = new Map(items.map((item) => [item.name, item]));

    for (const importable of gcx.importables) {
        if (importable.type === "FUNCTION") {
            checkActions(gcx, itemNames, importable.actions);
        } else if (importable.type === "EVENT") {
            checkActions(gcx, itemNames, importable.actions);
        } else if (importable.type === "REGION") {
            checkActions(gcx, itemNames, importable.onEnterActions ?? []);
            checkActions(gcx, itemNames, importable.onExitActions ?? []);
        } else if (importable.type === "ITEM") {
            checkActions(gcx, itemNames, importable.leftClickActions ?? []);
            checkActions(gcx, itemNames, importable.rightClickActions ?? []);
        } else if (importable.type === "MENU") {
            for (const slot of importable.slots) {
                checkActions(gcx, itemNames, slot.actions ?? []);
            }
        }
    }
}

function checkActions(
    gcx: GlobalCtxt,
    itemNames: ReadonlyMap<string, ImportableItem>,
    actions: readonly Action[]
): void {
    for (const action of actions) {
        if (
            action.type === "GIVE_ITEM" ||
            action.type === "REMOVE_ITEM" ||
            action.type === "DROP_ITEM"
        ) {
            if (action.itemName !== undefined) {
                checkItemReference(gcx, itemNames, action, action.itemName);
            }
        }

        if (action.type === "CONDITIONAL") {
            checkConditions(gcx, itemNames, action.conditions);
            checkActions(gcx, itemNames, action.ifActions);
            checkActions(gcx, itemNames, action.elseActions);
        } else if (action.type === "RANDOM") {
            checkActions(gcx, itemNames, action.actions);
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

    gcx.addDiagnostic(
        Diagnostic.error(`Unknown item '${itemName}'`)
            .addPrimarySpan(gcx.spans.getField(node as { itemName: string }, "itemName"))
            .addSubDiagnostic(
                Diagnostic.help(
                    "Item fields must match a top-level items[].name or a direct .snbt path."
                )
            )
    );
}
