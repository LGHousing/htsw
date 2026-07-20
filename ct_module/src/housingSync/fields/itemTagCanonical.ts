/**
 * The ONE definition of item-NBT equivalence that can run without the game:
 * both the import-time capture matching (`itemCapture.canonicalItemKey`) and
 * the drift hash (`importCache/hash.ts` menu slots) canonicalize through
 * here, so the two paths cannot disagree about whether two items are the
 * same. Everything is copy-on-write — hash callers pass tags owned by the
 * parse cache.
 */

export type TagLike = { type: string; value: unknown };

export function tagChild(tag: TagLike | undefined, key: string): TagLike | undefined {
    if (tag === undefined || tag.type !== "compound") return undefined;
    return (tag.value as Record<string, TagLike>)[key];
}

function compoundEntries(tag: TagLike): Record<string, TagLike> {
    return tag.value as Record<string, TagLike>;
}

function isEmptyCompound(tag: TagLike | undefined): boolean {
    return tag?.type === "compound" && Object.keys(compoundEntries(tag)).length === 0;
}

// Remove the tag at `path`, pruning only compounds emptied by that removal.
function withoutTagAtPath(tag: TagLike, path: string[]): TagLike {
    if (tag.type !== "compound") return tag;
    const value = compoundEntries(tag);
    const key = path[0];
    if (!Object.prototype.hasOwnProperty.call(value, key)) return tag;
    const out: Record<string, TagLike> = {};
    if (path.length === 1) {
        for (const k of Object.keys(value)) {
            if (k !== key) out[k] = value[k];
        }
        return { type: "compound", value: out };
    }
    const child = withoutTagAtPath(value[key], path.slice(1));
    if (child === value[key]) return tag;
    for (const k of Object.keys(value)) {
        if (k !== key) {
            out[k] = value[k];
        } else if (!isEmptyCompound(child)) {
            out[k] = child;
        }
    }
    return { type: "compound", value: out };
}

// Live reads add empty `tag` and `tag.display` shells. Normalize only those
// known paths; other empty compounds are authored item data.
function stripEmptyServerShells(tag: TagLike): TagLike {
    let normalized = tag;
    const display = tagChild(tagChild(normalized, "tag"), "display");
    if (isEmptyCompound(display)) {
        normalized = withoutTagAtPath(normalized, ["tag", "display"]);
    }
    if (isEmptyCompound(tagChild(normalized, "tag"))) {
        normalized = withoutTagAtPath(normalized, ["tag"]);
    }
    return normalized;
}

// Drop `tag.ExtraAttributes.interact_data` — the housing-scoped encoding of an
// item's click actions. It's non-portable, so it must never be part of an
// item's identity (an action item reads back with it; its source has none).
export function stripInteractData(tag: TagLike): TagLike {
    return withoutTagAtPath(tag, ["tag", "ExtraAttributes", "interact_data"]);
}

// The server strips `tag.ItemModel` (the 1.21-era item-model override) when an
// item round-trips through a 1.8.9 connection — verified live: a creative
// spawn with tag:{ItemModel:"minecraft:netherite_spear"} echoed back with
// tag:{}. Like interact_data, it can't be part of an item's identity.
function stripItemModel(tag: TagLike): TagLike {
    return withoutTagAtPath(tag, ["tag", "ItemModel"]);
}

// Housing renders a blank lore separator line as "§7"; a source snbt writes
// it as "". Map both to "§7" — copy-on-write, unlike the old in-place version.
export function normalizeBlankLoreSeparators(tag: TagLike): TagLike {
    const lore = tagChild(tagChild(tagChild(tag, "tag"), "display"), "Lore");
    if (lore === undefined || lore.type !== "list") return tag;
    const listValue = lore.value as { type: string; value: unknown[] };
    if (listValue.type !== "string") return tag;

    let needsRewrite = false;
    for (let i = 0; i < listValue.value.length; i++) {
        if (listValue.value[i] === "") needsRewrite = true;
    }
    if (!needsRewrite) return tag;

    const newLines: unknown[] = [];
    for (let i = 0; i < listValue.value.length; i++) {
        newLines.push(listValue.value[i] === "" ? "§7" : listValue.value[i]);
    }
    const newLore: TagLike = { type: "list", value: { type: "string", value: newLines } };
    const display = tagChild(tagChild(tag, "tag"), "display") as TagLike;
    const newDisplay: Record<string, TagLike> = {
        ...compoundEntries(display),
        Lore: newLore,
    };
    const inner = tagChild(tag, "tag") as TagLike;
    const newInner: Record<string, TagLike> = {
        ...compoundEntries(inner),
        display: { type: "compound", value: newDisplay },
    };
    return {
        type: "compound",
        value: { ...compoundEntries(tag), tag: { type: "compound", value: newInner } },
    };
}

// The server re-types integral tags when an item round-trips through it — a
// custom int comes back as a byte (verified with a saved echo of an injected
// skull: `hypixelPopulated: 1` returned as `1b`). Integral width therefore
// can't be part of an item's identity; fold byte/short/int to "int",
// preserving the value. Longs and floats keep their types — no re-typing of
// those has been observed, and folding them risks precision/representation
// mismatches for no known gain.
function normalizeIntegralTypes(tag: TagLike): TagLike {
    if (tag.type === "byte" || tag.type === "short") {
        return { type: "int", value: tag.value };
    }
    if (tag.type === "compound") {
        const value = compoundEntries(tag);
        const out: Record<string, TagLike> = {};
        for (const key of Object.keys(value)) {
            out[key] = normalizeIntegralTypes(value[key]);
        }
        return { type: "compound", value: out };
    }
    if (tag.type === "list") {
        const list = tag.value as { type: string; value: unknown[] };
        if (list.type === "byte" || list.type === "short") {
            return { type: "list", value: { type: "int", value: list.value.slice() } };
        }
        if (list.type === "compound") {
            const items = list.value.map(
                (entry) =>
                    normalizeIntegralTypes({
                        type: "compound",
                        value: entry,
                    }).value
            );
            return { type: "list", value: { type: "compound", value: items } };
        }
        return tag;
    }
    return tag;
}

function isNumericTagWithValue(tag: TagLike | undefined, expected: number): boolean {
    if (tag === undefined) return false;
    return (
        (tag.type === "byte" || tag.type === "short" || tag.type === "int") &&
        tag.value === expected
    );
}

// Vanilla stamps defaults onto every live ItemStack that a hand-written snbt
// omits: Damage 0, Count 1, and the namespaced item id. Normalize them away /
// into namespaced form so "what the file says" and "what the game hands back"
// agree; non-default values (real damage/meta, stack counts) stay.
function normalizeItemDefaults(tag: TagLike): TagLike {
    if (tag.type !== "compound") return tag;
    const value: Record<string, TagLike> = { ...compoundEntries(tag) };
    if (isNumericTagWithValue(value["Damage"], 0)) delete value["Damage"];
    if (isNumericTagWithValue(value["Count"], 1)) delete value["Count"];
    const id: TagLike | undefined = Object.prototype.hasOwnProperty.call(value, "id")
        ? value["id"]
        : undefined;
    if (id !== undefined && id.type === "string" && String(id.value).indexOf(":") < 0) {
        value["id"] = { type: "string", value: `minecraft:${String(id.value)}` };
    }
    return { type: "compound", value };
}

export function canonicalItemTag(tag: TagLike): TagLike {
    return stripEmptyServerShells(
        normalizeBlankLoreSeparators(
            normalizeItemDefaults(
                normalizeIntegralTypes(stripItemModel(stripInteractData(tag)))
            )
        )
    );
}
