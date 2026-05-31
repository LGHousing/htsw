/**
 * Minecraft items a normal Hypixel Housing player cannot creative-spawn.
 * The importer injects items via creative inventory (for icons, GIVE_ITEM,
 * etc.); these never land, so we detect them up front and skip rather than
 * open a picker and fail the whole import.
 *
 * NOTE: this list is incomplete — it only covers items we've confirmed. See
 * the tracking issue to fill it out. Barriers ARE spawnable on Hypixel, so
 * they are intentionally excluded.
 */
const UNSPAWNABLE_ITEMS = new Set<string>([
    "command_block",
    "mob_spawner",
]);

/** True if `itemId` (with or without a `minecraft:` prefix) can't be creative-spawned. */
export function isUnspawnableItem(itemId: string): boolean {
    const colon = itemId.indexOf(":");
    const bare = colon === -1 ? itemId : itemId.substring(colon + 1);
    return UNSPAWNABLE_ITEMS.has(bare.toLowerCase());
}
