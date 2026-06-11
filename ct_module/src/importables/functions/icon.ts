import type { FunctionIcon } from "htsw/types";
import { MINECRAFT_ITEMS } from "htsw/types";

const McItem = Java.type("net.minecraft.item.Item");
const ItemStack = Java.type("net.minecraft.item.ItemStack");

// A function icon's identity: the item's HTSW name + stack count. NBT and the
// display name/lore Housing hangs on the slot are irrelevant, and damage/meta
// is dropped — the FunctionIcon model and the importer only ever set item + count.
export type FunctionIconSnapshot = { item: string; count: number };

function stackCount(stack: any): number {
    const n = stack.field_77994_a;
    return typeof n === "number" ? n : 0;
}

// The one boundary where MC's numeric item world meets HTSW's name vocabulary:
// map a live item's id to its HTSW name. MINECRAFT_ITEMS is the same table the
// parser validates against, and its `id` is the 1.8 getIdFromItem value.
function itemNameForId(itemId: number): string | null {
    for (let i = 0; i < MINECRAFT_ITEMS.length; i++) {
        if (MINECRAFT_ITEMS[i].id === itemId) return MINECRAFT_ITEMS[i].name;
    }
    return null;
}

/**
 * Identity of a function icon: HTSW item name + stack count, ignoring NBT and
 * the display name/lore Housing hangs on the slot. Returns null for an empty
 * stack or an item outside HTSW's table.
 */
export function snapshotIconStack(stack: any): FunctionIconSnapshot | null {
    if (stack === null || stack === undefined) return null;
    const mcItem = stack.func_77973_b();
    if (mcItem === null || mcItem === undefined) return null;
    // @ts-ignore func_150891_b is Item.getIdFromItem in 1.8.
    const name = itemNameForId(McItem.func_150891_b(mcItem));
    if (name === null) return null;
    return { item: name, count: stackCount(stack) };
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

/**
 * The import.json `FunctionIcon` form of a live icon snapshot. The snapshot is
 * already name-based, so this only drops a redundant count of 1.
 */
export function functionIconFromSnapshot(
    snapshot: FunctionIconSnapshot | null
): FunctionIcon | undefined {
    if (snapshot === null) return undefined;
    return snapshot.count > 1
        ? { item: snapshot.item, count: snapshot.count }
        : { item: snapshot.item };
}

export function iconSnapshotsEqual(
    a: FunctionIconSnapshot | null,
    b: FunctionIconSnapshot | null
): boolean {
    if (a === null || b === null) return false;
    return a.item === b.item && a.count === b.count;
}

/**
 * Item-identity equality for the icon placement path: item name + count,
 * ignoring NBT. The exact-NBT areItemStacksEqual used for GIVE_ITEM is too
 * strict for an icon, which the importer can only ever set to {item, count}.
 */
export function iconStacksEqual(a: any, b: any): boolean {
    return iconSnapshotsEqual(snapshotIconStack(a), snapshotIconStack(b));
}
