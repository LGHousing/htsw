import type { Tag, TagCompound, TagList } from "htsw/nbt";
import { ampToSection } from "../text/colorCodes";

export type BuildItemNbtForm = {
    itemName: string;
    count: number;
    metadata?: number | null;
    displayName?: string;
    lore?: string[];
    enchants?: BuildItemEnchant[];
};

export type BuildItemEnchant = {
    name: string;
    level: number;
};

const ENCHANTMENT_IDS: Record<string, number> = {
    "Protection": 0,
    "Fire Protection": 1,
    "Feather Falling": 2,
    "Blast Protection": 3,
    "Projectile Projection": 4,
    "Respiration": 5,
    "Aqua Affinity": 6,
    "Thorns": 7,
    "Depth Strider": 8,
    "Sharpness": 16,
    "Smite": 17,
    "Bane Of Arthropods": 18,
    "Knockback": 19,
    "Fire Aspect": 20,
    "Looting": 21,
    "Efficiency": 32,
    "Silk Touch": 33,
    "Unbreaking": 34,
    "Fortune": 35,
    "Power": 48,
    "Punch": 49,
    "Flame": 50,
    "Infinity": 51,
    "Luck Of The Sea": 61,
    "Lure": 62,
};

export function buildItemTag(form: BuildItemNbtForm): TagCompound {
    const tag: Record<string, Tag | undefined> = {
        id: stringTag(`minecraft:${normalizeMinecraftItemName(form.itemName)}`),
        Count: byteTag(clampInt(form.count, 1, 127)),
    };

    const metadata = clampInt(form.metadata ?? 0, 0, 32767);
    if (metadata !== 0) {
        tag.Damage = shortTag(metadata);
    }

    const display = buildDisplayTag(form);
    const ench = buildEnchantList(form.enchants ?? []);
    if (display || ench) {
        tag.tag = compoundTag({
            display,
            ench,
        });
    }

    return compoundTag(tag);
}

export function enchantmentIdForName(name: string): number | undefined {
    return ENCHANTMENT_IDS[name];
}

function buildDisplayTag(form: BuildItemNbtForm): TagCompound | undefined {
    const displayName = form.displayName?.trim();
    const lore = trimTrailingEmptyLines(form.lore ?? []);
    if (!displayName && lore.length === 0) return undefined;

    return compoundTag({
        Name: displayName ? stringTag(ampToSection(displayName)) : undefined,
        Lore: lore.length > 0
            ? listTag("string", lore.map((line) => ampToSection(line)))
            : undefined,
    });
}

function buildEnchantList(enchants: BuildItemEnchant[]): TagList | undefined {
    const entries = enchants.flatMap((enchant) => {
        const id = enchantmentIdForName(enchant.name);
        if (id === undefined) return [];
        return [compoundTag({
            id: shortTag(id),
            lvl: shortTag(clampInt(enchant.level, 1, 32767)),
        })];
    });
    if (entries.length === 0) return undefined;

    return listTag("compound", entries.map((entry) => entry.value));
}

function trimTrailingEmptyLines(lines: readonly string[]): string[] {
    const out = [...lines];
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    return out;
}

function normalizeMinecraftItemName(name: string): string {
    return name.replace(/^minecraft:/, "");
}

function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.trunc(value)));
}

function byteTag(value: number): Tag {
    return { type: "byte", value };
}

function shortTag(value: number): Tag {
    return { type: "short", value };
}

function stringTag(value: string): Tag {
    return { type: "string", value };
}

function compoundTag(value: Record<string, Tag | undefined>): TagCompound {
    return { type: "compound", value };
}

function listTag<T extends Tag["type"]>(
    type: T,
    value: Extract<Tag, { type: T }>["value"][]
): TagList {
    return { type: "list", value: { type, value } };
}
