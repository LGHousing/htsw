import type { Tag, TagCompound, TagList } from "htsw/nbt";
import { ampToSection, sectionToAmp } from "../text/colorCodes";

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

const ENCHANTMENT_NAMES: Record<number, string> = Object.fromEntries(
    Object.entries(ENCHANTMENT_IDS).map(([name, id]) => [id, name]),
);

export function enchantmentNameForId(id: number): string | undefined {
    return ENCHANTMENT_NAMES[id];
}

/** The editable fields of an item, read out of a parsed item NBT tag. Display
 * name and lore come back with `&` codes (the form's convention), regardless of
 * whether the file stored them as `§`. */
export type ItemFields = {
    itemName: string;
    count: number;
    metadata: number;
    displayName: string;
    lore: string[];
    enchants: BuildItemEnchant[];
};

/** Reverse of {@link buildItemTag}: pull the editable fields out of a parsed
 * item tag. Returns null when the tag isn't a compound with a string `id`. */
export function itemFieldsFromTag(tag: Tag): ItemFields | null {
    if (tag.type !== "compound") return null;
    const fields = tag.value;
    const id = fields.id;
    if (id?.type !== "string" || typeof id.value !== "string") return null;

    const tagCompound = compoundValue(fields.tag);
    const display = compoundValue(tagCompound?.display);

    return {
        itemName: normalizeMinecraftItemName(id.value),
        count: numberValue(fields.Count) ?? 1,
        metadata: numberValue(fields.Damage) ?? 0,
        displayName: stringValue(display?.Name) !== undefined
            ? sectionToAmp(stringValue(display?.Name) as string)
            : "",
        lore: stringListValue(display?.Lore).map((line) => sectionToAmp(line)),
        enchants: enchantsFromTag(tagCompound?.ench),
    };
}

/** Apply edited fields onto an existing parsed tag, preserving every NBT key the
 * editor doesn't manage (SkullOwner, HideFlags, attribute modifiers, ...) so a
 * round-trip through the editor never drops data. Falls back to a fresh
 * {@link buildItemTag} when the original isn't a compound. */
export function applyItemEditsToTag(original: Tag, form: BuildItemNbtForm): TagCompound {
    if (original.type !== "compound") return buildItemTag(form);
    const next: Record<string, Tag | undefined> = { ...original.value };

    next.id = stringTag(`minecraft:${normalizeMinecraftItemName(form.itemName)}`);
    next.Count = byteTag(clampInt(form.count, 1, 127));

    const metadata = clampInt(form.metadata ?? 0, 0, 32767);
    if (metadata !== 0) next.Damage = shortTag(metadata);
    else delete next.Damage;

    const innerTag = { ...(compoundValue(original.value.tag) ?? {}) };
    const display = { ...(compoundValue(innerTag.display) ?? {}) };

    const displayName = form.displayName?.trim();
    if (displayName) display.Name = stringTag(ampToSection(displayName));
    else delete display.Name;

    const lore = trimTrailingEmptyLines(form.lore ?? []);
    if (lore.length > 0) display.Lore = listTag("string", lore.map((line) => ampToSection(line)));
    else delete display.Lore;

    if (hasAnyValue(display)) innerTag.display = compoundTag(display);
    else delete innerTag.display;

    const ench = buildEnchantList(form.enchants ?? []);
    if (ench) innerTag.ench = ench;
    else delete innerTag.ench;

    if (hasAnyValue(innerTag)) next.tag = compoundTag(innerTag);
    else delete next.tag;

    return compoundTag(next);
}

function enchantsFromTag(tag: Tag | undefined): BuildItemEnchant[] {
    if (tag?.type !== "list" || tag.value.type !== "compound") return [];
    const entries = tag.value.value as Record<string, Tag | undefined>[];
    return entries.flatMap((entry) => {
        const id = numberValue(entry.id);
        const name = id === undefined ? undefined : enchantmentNameForId(id);
        if (name === undefined) return [];
        return [{ name, level: numberValue(entry.lvl) ?? 1 }];
    });
}

function compoundValue(tag: Tag | undefined): Record<string, Tag | undefined> | undefined {
    return tag?.type === "compound" ? tag.value : undefined;
}

function numberValue(tag: Tag | undefined): number | undefined {
    return tag !== undefined && typeof tag.value === "number" ? tag.value : undefined;
}

function stringValue(tag: Tag | undefined): string | undefined {
    return tag?.type === "string" && typeof tag.value === "string" ? tag.value : undefined;
}

function stringListValue(tag: Tag | undefined): string[] {
    if (tag?.type !== "list" || tag.value.type !== "string") return [];
    return (tag.value.value as string[]).map((line) => String(line));
}

function hasAnyValue(record: Record<string, Tag | undefined>): boolean {
    return Object.values(record).some((value) => value !== undefined);
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
