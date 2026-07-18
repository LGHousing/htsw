/**
 * Minecraft items a normal Hypixel Housing player cannot creative-spawn.
 * The importer injects items via creative inventory (for icons, GIVE_ITEM,
 * etc.); these never land, so the check passes reject them up front — and the
 * importer's runtime guards skip them — rather than fail mid-import.
 *
 * Verified by a full sweep of all 336 1.8.9 item ids in a live Housing
 * (2026-07-09): each id was creative-spawned and the slot read back; exactly
 * these six never landed. Everything else — including barrier, dragon_egg,
 * monster_egg, and all spawn eggs — spawns fine. The sweep tested one damage
 * value per id; brown_mushroom_block was additionally confirmed refused at
 * both damage 0 and 14, so refusal looks id-level, not per-variant.
 */
const UNSPAWNABLE_ITEMS = new Set<string>([
    "brown_mushroom_block",
    "command_block",
    "command_block_minecart",
    "farmland",
    "mob_spawner",
    "red_mushroom_block",
]);

/** True if `itemId` (with or without a `minecraft:` prefix) can't be creative-spawned. */
export function isUnspawnableItem(itemId: string): boolean {
    const colon = itemId.indexOf(":");
    const bare = colon === -1 ? itemId : itemId.substring(colon + 1);
    return UNSPAWNABLE_ITEMS.has(bare.toLowerCase());
}
