/**
 * Lore straight from an item's NBT (`display.Lore`).
 *
 * Never parse `Item.getLore()`: in ChatTriggers it is
 * `ItemStack.getTooltip(player, advancedItemTooltips)`, the rendered tooltip.
 * That prepends the item name, prefixes every lore line with vanilla's
 * `§5§o`, appends `minecraft:<id>` / `NBT: n tag(s)` while F3+H is on, and
 * carries whatever lines client tooltip mods inject. Parsers fed that read
 * junk: a function with no description came back as
 * `Click to rename! minecraft:book NBT: 1 tag(s) (Miscellaneous) ...`.
 */
export function itemLore(item: Item): string[] {
    if (typeof (item as { getItemStack?: unknown }).getItemStack !== "function") {
        // Test doubles are plain objects that only stub `getLore`.
        return item.getLore();
    }
    const tag = item.getItemStack().func_77978_p();
    if (tag === null) return [];
    const display = tag.func_74781_a("display");
    if (display === null || !isNbtKind(display, "NBTTagCompound")) return [];
    const lore = display.func_74781_a("Lore");
    if (lore === null || !isNbtKind(lore, "NBTTagList")) return [];
    const count = lore.func_74745_c();
    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
        const entry = lore.func_179238_g(i);
        lines.push(
            isNbtKind(entry, "NBTTagString")
                ? String(entry.func_150285_a_())
                : String(entry)
        );
    }
    return lines;
}

function isNbtKind<K extends keyof HtswMinecraftNbtKindMap>(
    tag: HtswMinecraftNbtBase,
    kind: K
): tag is HtswMinecraftNbtKindMap[K] {
    return String(tag.getClass().getSimpleName()) === kind;
}
