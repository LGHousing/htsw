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

function stripEmptyCompounds(tag: TagLike): TagLike {
    if (tag.type !== "compound") return tag;
    const value = compoundEntries(tag);
    const out: Record<string, TagLike> = {};
    for (const key of Object.keys(value)) {
        const child = stripEmptyCompounds(value[key]);
        if (
            child.type === "compound" &&
            Object.keys(child.value as Record<string, unknown>).length === 0
        ) {
            continue;
        }
        out[key] = child;
    }
    return { type: "compound", value: out };
}

// Drop `tag.ExtraAttributes.interact_data` — the housing-scoped encoding of an
// item's click actions — from a tag, rebuilding only the path it sits on. It's
// non-portable, so it must never be part of an item's identity (an action item
// reads back with it; its source has none).
function stripInteractData(tag: TagLike): TagLike {
    if (tag.type !== "compound") return tag;
    const value = compoundEntries(tag);
    const inner = value["tag"];
    if (inner === undefined || inner.type !== "compound") return tag;
    const innerValue = compoundEntries(inner);
    const extra = innerValue["ExtraAttributes"];
    if (extra === undefined || extra.type !== "compound") return tag;
    const extraValue = compoundEntries(extra);
    if (extraValue["interact_data"] === undefined) return tag;

    const newExtra: Record<string, TagLike> = {};
    for (const k of Object.keys(extraValue)) {
        if (k !== "interact_data") newExtra[k] = extraValue[k];
    }
    const newInner: Record<string, TagLike> = {};
    for (const k of Object.keys(innerValue)) {
        newInner[k] = k === "ExtraAttributes" ? { type: "compound", value: newExtra } : innerValue[k];
    }
    const newRoot: Record<string, TagLike> = {};
    for (const k of Object.keys(value)) {
        newRoot[k] = k === "tag" ? { type: "compound", value: newInner } : value[k];
    }
    return { type: "compound", value: newRoot };
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
    const newDisplay: Record<string, TagLike> = { ...compoundEntries(display), Lore: newLore };
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
    const id = value["id"];
    if (id !== undefined && id.type === "string" && String(id.value).indexOf(":") < 0) {
        value["id"] = { type: "string", value: `minecraft:${id.value}` };
    }
    return { type: "compound", value };
}

export function canonicalItemTag(tag: TagLike): TagLike {
    return stripEmptyCompounds(
        normalizeBlankLoreSeparators(normalizeItemDefaults(stripInteractData(tag)))
    );
}
