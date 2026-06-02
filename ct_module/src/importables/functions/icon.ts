import type { FunctionIcon } from "htsw/types";

const McItem = Java.type("net.minecraft.item.Item");
const ItemStack = Java.type("net.minecraft.item.ItemStack");

export type FunctionIconSnapshot = { itemId: number; meta: number; count: number };

function stackCount(stack: any): number {
    const n = stack.field_77994_a;
    return typeof n === "number" ? n : 0;
}

/**
 * Item id + damage + count of an NMS ItemStack, ignoring NBT. A function icon
 * is only ever {item, count}, so its identity lives entirely in these three
 * fields — the display name/lore the GUI hangs on the slot are irrelevant.
 */
export function snapshotIconStack(stack: any): FunctionIconSnapshot | null {
    if (stack === null || stack === undefined) return null;
    const mcItem = stack.func_77973_b();
    if (mcItem === null || mcItem === undefined) return null;
    // @ts-ignore func_150891_b is Item.getIdFromItem in 1.8.
    const itemId: number = McItem.func_150891_b(mcItem);
    return {
        itemId,
        meta: stack.func_77960_j(),
        count: stackCount(stack),
    };
}

export function createPlainIconStack(icon: FunctionIcon): any {
    // @ts-ignore func_111206_d is Item.getByNameOrId in 1.8.
    const mcItem = McItem.func_111206_d(icon.item);
    if (mcItem === null) {
        throw new Error(`Unknown function icon item '${icon.item}'`);
    }
    // @ts-ignore ChatTriggers' TS declarations do not expose this NMS constructor.
    return new ItemStack(mcItem, icon.count ?? 1);
}

export function createPlainIconItem(icon: FunctionIcon): Item {
    // @ts-ignore ChatTriggers' TS declarations do not expose this NMS constructor.
    return new Item(createPlainIconStack(icon));
}

export function desiredIconSnapshot(icon: FunctionIcon): FunctionIconSnapshot | null {
    return snapshotIconStack(createPlainIconStack(icon));
}

export function iconSnapshotsEqual(
    a: FunctionIconSnapshot | null,
    b: FunctionIconSnapshot | null
): boolean {
    if (a === null || b === null) return false;
    return a.itemId === b.itemId && a.meta === b.meta && a.count === b.count;
}

/**
 * Item-identity equality for the icon placement path: item + damage + count,
 * ignoring NBT. The exact-NBT areItemStacksEqual used for GIVE_ITEM is too
 * strict for an icon, which the importer can only ever set to {item, count}.
 */
export function iconStacksEqual(a: any, b: any): boolean {
    return iconSnapshotsEqual(snapshotIconStack(a), snapshotIconStack(b));
}
