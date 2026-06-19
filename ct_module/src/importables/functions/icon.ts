import type { FunctionIcon } from "htsw/types";
import { MINECRAFT_ITEMS } from "htsw/types";

import { itemHasEnchantGlint, itemWithEnchantGlint } from "../../utils/nbt";

const McItem = Java.type("net.minecraft.item.Item");
const ItemStack = Java.type("net.minecraft.item.ItemStack");

// A function icon's identity: the item's HTSW name, stack count, and whether it
// carries the enchantment glint. The display name/lore Housing hangs on the slot
// is irrelevant, and damage/meta is dropped — those three are all the importer sets.
export type FunctionIconSnapshot = { item: string; count: number; enchanted: boolean };

function stackCount(stack: any): number {
    const n = stack.field_77994_a;
    return typeof n === "number" ? n : 0;
}

// The one boundary where MC's numeric item world meets HTSW's name vocabulary:
// map a live item's id to the canonical namespaced id (`minecraft:<name>`) that
// the import.json loader (parseMinecraftItemId) also produces. Emitting the same
// form on both sides is what lets a read-back icon and a loaded icon compare and
// hash equal with no reconciliation. MINECRAFT_ITEMS is the same table the parser
// validates against (bare `.name`); its `id` is the 1.8 getIdFromItem value.
function itemNameForId(itemId: number): string | null {
    for (let i = 0; i < MINECRAFT_ITEMS.length; i++) {
        if (MINECRAFT_ITEMS[i].id === itemId) return `minecraft:${MINECRAFT_ITEMS[i].name}`;
    }
    return null;
}

/**
 * Identity of a function icon: HTSW item name, stack count, and enchantment
 * glint, ignoring NBT and the display name/lore Housing hangs on the slot.
 * Returns null for an empty stack or an item outside HTSW's table.
 */
export function snapshotIconStack(stack: any): FunctionIconSnapshot | null {
    if (stack === null || stack === undefined) return null;
    const mcItem = stack.func_77973_b();
    if (mcItem === null || mcItem === undefined) return null;
    // @ts-expect-error func_150891_b is Item.getIdFromItem in 1.8.
    const name = itemNameForId(McItem.func_150891_b(mcItem));
    if (name === null) return null;
    return {
        item: name,
        count: stackCount(stack),
        enchanted: itemHasEnchantGlint(new Item(stack)),
    };
}

function createIconStack(icon: FunctionIcon): any {
    // @ts-expect-error func_111206_d is Item.getByNameOrId in 1.8.
    const mcItem = McItem.func_111206_d(icon.item);
    if (mcItem === null) {
        throw new Error(`Unknown function icon item '${icon.item}'`);
    }
    // @ts-expect-error ChatTriggers' TS declarations do not expose this NMS constructor.
    const stack = new ItemStack(mcItem, icon.count ?? 1);
    return icon.enchanted ? itemWithEnchantGlint(new Item(stack)).getItemStack() : stack;
}

export function createIconItem(icon: FunctionIcon): Item {
    return new Item(createIconStack(icon));
}

export function desiredIconSnapshot(icon: FunctionIcon): FunctionIconSnapshot | null {
    return snapshotIconStack(createIconStack(icon));
}

/**
 * The import.json `FunctionIcon` form of a live icon snapshot: drops a redundant
 * count of 1 and a false glint so the written entry stays minimal.
 */
export function functionIconFromSnapshot(
    snapshot: FunctionIconSnapshot | null
): FunctionIcon | undefined {
    if (snapshot === null) return undefined;
    const icon: FunctionIcon = { item: snapshot.item };
    if (snapshot.count > 1) icon.count = snapshot.count;
    if (snapshot.enchanted) icon.enchanted = true;
    return icon;
}

export function iconSnapshotsEqual(
    a: FunctionIconSnapshot | null,
    b: FunctionIconSnapshot | null
): boolean {
    if (a === null || b === null) return false;
    return a.item === b.item && a.count === b.count && a.enchanted === b.enchanted;
}

/**
 * Item-identity equality for the icon placement path: item name + count + glint,
 * ignoring NBT. The exact-NBT areItemStacksEqual used for GIVE_ITEM is too
 * strict for an icon, which the importer can only ever set to {item, count, glint}.
 */
export function iconStacksEqual(a: any, b: any): boolean {
    return iconSnapshotsEqual(snapshotIconStack(a), snapshotIconStack(b));
}
