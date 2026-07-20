import type { Tag, TagCompound } from "htsw/nbt";
import { Long, nbt as htswNbt } from "htsw";
import { removedFormatting } from "./helpers";
import { javaType, runtimeString } from "./java";

const NBTTagByte = javaType("net.minecraft.nbt.NBTTagByte");
const NBTTagShort = javaType("net.minecraft.nbt.NBTTagShort");
const NBTTagInt = javaType("net.minecraft.nbt.NBTTagInt");
const NBTTagLong = javaType("net.minecraft.nbt.NBTTagLong");
const NBTTagFloat = javaType("net.minecraft.nbt.NBTTagFloat");
const NBTTagDouble = javaType("net.minecraft.nbt.NBTTagDouble");
const NBTTagString = javaType("net.minecraft.nbt.NBTTagString");
const NBTTagList = javaType("net.minecraft.nbt.NBTTagList");
const NBTTagCompound = javaType("net.minecraft.nbt.NBTTagCompound");
const NBTTagByteArray = javaType("net.minecraft.nbt.NBTTagByteArray");
const NBTTagIntArray = javaType("net.minecraft.nbt.NBTTagIntArray");
const JLong = javaType("java.lang.Long");

function tagFromListElement(type: Tag["type"], value: Tag["value"]): Tag {
    return { type, value } as Tag;
}

function toJavaLong(value: Long): HtswJavaLong {
    return JLong.valueOf(value.toString());
}

function toMinecraftTag(tag: TagCompound): HtswMinecraftNbtCompound;
function toMinecraftTag(tag: Tag): HtswMinecraftNbtBase;
function toMinecraftTag(tag: Tag): HtswMinecraftNbtBase {
    if (tag.type === "byte") return new NBTTagByte(tag.value);
    if (tag.type === "short") return new NBTTagShort(tag.value);
    if (tag.type === "int") return new NBTTagInt(tag.value);
    if (tag.type === "long") return new NBTTagLong(toJavaLong(tag.value));
    if (tag.type === "float") return new NBTTagFloat(tag.value);
    if (tag.type === "double") return new NBTTagDouble(tag.value);
    if (tag.type === "string") return new NBTTagString(tag.value);

    if (tag.type === "list") {
        const listTag = new NBTTagList();
        for (let i = 0; i < tag.value.value.length; i++) {
            listTag.func_74742_a(
                toMinecraftTag(tagFromListElement(tag.value.type, tag.value.value[i]))
            );
        }
        return listTag;
    }

    if (tag.type === "compound") {
        const compoundTag = new NBTTagCompound();
        const compoundKeys = Object.keys(tag.value);
        for (let i = 0; i < compoundKeys.length; i++) {
            const child = tag.value[compoundKeys[i]];
            if (child === undefined) continue;
            compoundTag.func_74782_a(compoundKeys[i], toMinecraftTag(child));
        }
        return compoundTag;
    }

    if (tag.type === "byte_array") {
        return new NBTTagByteArray(Java.to(tag.value, "byte[]"));
    }

    if (tag.type === "int_array") {
        return new NBTTagIntArray(Java.to(tag.value, "int[]"));
    }

    // as list for now
    const listTag = new NBTTagList();
    if (tag.type === "short_array") {
        for (let i = 0; i < tag.value.length; i++) {
            listTag.func_74742_a(new NBTTagShort(tag.value[i]));
        }
        return listTag;
    }
    for (let i = 0; i < tag.value.length; i++) {
        listTag.func_74742_a(new NBTTagLong(toJavaLong(tag.value[i])));
    }
    return listTag;
}

const ItemStack = javaType("net.minecraft.item.ItemStack");
const JsonToNBT = javaType("net.minecraft.nbt.JsonToNBT");

function hasMinecraftTagKind<K extends keyof HtswMinecraftNbtKindMap>(
    _tag: HtswMinecraftNbtBase,
    actualKind: string,
    expectedKind: K
): _tag is HtswMinecraftNbtKindMap[K] {
    return actualKind === expectedKind;
}

function fromMinecraftTag(tag: HtswMinecraftNbtBase): Tag {
    const kind = String(tag.getClass().getSimpleName());

    if (hasMinecraftTagKind(tag, kind, "NBTTagByte")) {
        return { type: "byte", value: tag.func_150290_f() };
    }
    if (hasMinecraftTagKind(tag, kind, "NBTTagShort")) {
        return { type: "short", value: tag.func_150289_e() };
    }
    if (hasMinecraftTagKind(tag, kind, "NBTTagInt")) {
        return { type: "int", value: tag.func_150287_d() };
    }
    if (hasMinecraftTagKind(tag, kind, "NBTTagLong")) {
        const javaLong = tag.func_150291_c();
        return { type: "long", value: Long.fromString(String(javaLong)) };
    }
    if (hasMinecraftTagKind(tag, kind, "NBTTagFloat")) {
        return { type: "float", value: tag.func_150288_h() };
    }
    if (hasMinecraftTagKind(tag, kind, "NBTTagDouble")) {
        return { type: "double", value: tag.func_150286_g() };
    }
    if (hasMinecraftTagKind(tag, kind, "NBTTagString")) {
        return { type: "string", value: String(tag.func_150285_a_()) };
    }
    if (hasMinecraftTagKind(tag, kind, "NBTTagByteArray")) {
        const arr = tag.func_150292_c();
        const out: number[] = [];
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
        return { type: "byte_array", value: out };
    }
    if (hasMinecraftTagKind(tag, kind, "NBTTagIntArray")) {
        const arr = tag.func_150302_c();
        const out: number[] = [];
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
        return { type: "int_array", value: out };
    }
    if (hasMinecraftTagKind(tag, kind, "NBTTagCompound")) {
        const value: Record<string, Tag | undefined> = {};
        const keys = tag.func_150296_c();
        const keyArray = keys.toArray();
        const length: number = keyArray.length;
        for (let i = 0; i < length; i++) {
            const key = runtimeString(keyArray[i]);
            const child = tag.func_74781_a(key);
            if (child === null) continue;
            value[key] = fromMinecraftTag(child);
        }
        return { type: "compound", value };
    }
    if (hasMinecraftTagKind(tag, kind, "NBTTagList")) {
        const count: number = tag.func_74745_c();
        const elements: Tag[] = [];
        for (let i = 0; i < count; i++) {
            const child = tag.func_179238_g(i);
            elements.push(fromMinecraftTag(child));
        }
        if (elements.length === 0) {
            return { type: "list", value: { type: "byte", value: [] } };
        }
        const elementType = elements[0].type;
        const innerValues: unknown[] = [];
        for (let i = 0; i < elements.length; i++) {
            innerValues.push((elements[i] as { value: unknown }).value);
        }
        return {
            type: "list",
            value: { type: elementType, value: innerValues } as Tag["value"],
        } as Tag;
    }

    return { type: "string", value: `<unknown NBT type ${kind}>` };
}

export function itemToHtswTag(item: Item): Tag {
    const stack = item.getItemStack();
    const compound = new NBTTagCompound();
    stack.func_77955_b(compound);
    return fromMinecraftTag(compound);
}

export function getItemFromNbt(nbt: Tag): Item {
    const normalized = normalizeItemNbtForMinecraft(nbt);
    if (normalized.type !== "compound") {
        throw new Error(`Cannot create item from ${normalized.type} NBT`);
    }
    const mcTag = toMinecraftTag(normalized);

    const itemStack = ItemStack.func_77949_a(/*loadItemStackFromNBT*/ mcTag);
    if (itemStack === null) {
        throw new Error(`Cannot create item from NBT id '${itemIdForError(nbt)}'`);
    }

    return new Item(itemStack);
}

/**
 * Parse a Minecraft SNBT string (the format `Item.getRawNBT()` returns) into
 * a spawnable Item.
 */
export function getItemFromSnbt(snbt: string): Item {
    const compound = JsonToNBT.func_180713_a(/*parseStringIntoCompound*/ snbt);
    const itemStack = ItemStack.func_77949_a(/*loadItemStackFromNBT*/ compound);
    if (itemStack === null) {
        throw new Error("Cannot create item from SNBT");
    }
    return new Item(itemStack);
}

export function readItemDisplayAliases(nbt: Tag): string[] {
    const name = getNestedString(nbt, ["tag", "display", "Name"]);
    if (name === undefined) {
        return [];
    }

    const normalized = normalizeFormattingForMinecraft(name);
    const stripped = removedFormatting(normalized).trim();
    return stripped === "" ? [normalized] : [normalized, stripped];
}

function normalizeItemNbtForMinecraft(tag: Tag): Tag {
    return normalizeItemNbtColorCodes(tag);
}

function normalizeItemNbtColorCodes(tag: Tag): Tag {
    if (tag.type !== "compound") {
        return tag;
    }

    const display = getNestedCompound(tag, ["tag", "display"]);
    if (display === undefined) {
        return tag;
    }

    const normalized = cloneTag(tag);
    const normalizedDisplay = getNestedCompound(normalized, ["tag", "display"]);
    if (normalizedDisplay === undefined) {
        return normalized;
    }

    const displayKeys = Object.keys(normalizedDisplay.value);
    for (let i = 0; i < displayKeys.length; i++) {
        const child = normalizedDisplay.value[displayKeys[i]];
        if (child === undefined) {
            continue;
        }

        normalizedDisplay.value[displayKeys[i]] = normalizeFormattingStringTags(child);
    }

    return normalized;
}

function itemIdForError(tag: Tag): string {
    const id = getNestedString(tag, ["id"]);
    return id === undefined ? "<missing>" : id;
}

function normalizeFormattingStringTags(tag: Tag): Tag {
    if (tag.type === "string") {
        return { type: "string", value: normalizeFormattingForMinecraft(tag.value) };
    }

    if (tag.type === "list") {
        return {
            type: "list",
            value: {
                type: tag.value.type,
                value:
                    tag.value.type === "string"
                        ? tag.value.value.map((value) =>
                              typeof value === "string"
                                  ? normalizeFormattingForMinecraft(value)
                                  : value
                          )
                        : tag.value.value,
            },
        };
    }

    return tag;
}

function normalizeFormattingForMinecraft(value: string): string {
    return value.replace(/&([0-9a-fklmnor])/gi, "\u00a7$1");
}

function getNestedString(tag: Tag, path: string[]): string | undefined {
    const nested = getNestedTag(tag, path);
    return nested?.type === "string" ? nested.value : undefined;
}

function getNestedCompound(tag: Tag, path: string[]): TagCompound | undefined {
    const nested = getNestedTag(tag, path);
    return nested?.type === "compound" ? nested : undefined;
}

function getNestedTag(tag: Tag, path: string[]): Tag | undefined {
    let current: Tag | undefined = tag;
    for (let i = 0; i < path.length; i++) {
        if (current?.type !== "compound") {
            return undefined;
        }
        current = current.value[path[i]];
    }
    return current;
}

function cloneTag(tag: Tag): Tag {
    if (tag.type === "compound") {
        const value: Record<string, Tag | undefined> = {};
        const cloneKeys = Object.keys(tag.value);
        for (let i = 0; i < cloneKeys.length; i++) {
            const child = tag.value[cloneKeys[i]];
            value[cloneKeys[i]] = child === undefined ? undefined : cloneTag(child);
        }
        return { type: "compound", value };
    }

    if (tag.type === "list") {
        return {
            type: "list",
            value: {
                type: tag.value.type,
                value: tag.value.value.slice(),
            },
        };
    }

    if (
        tag.type === "byte_array" ||
        tag.type === "short_array" ||
        tag.type === "int_array" ||
        tag.type === "long_array"
    ) {
        return { type: tag.type, value: tag.value.slice() } as Tag;
    }

    return tag;
}

const INTERACT_DATA_PATH = ["tag", "ExtraAttributes", "interact_data"];

/**
 * Pull just `tag.ExtraAttributes.interact_data` out of a captured item's SNBT,
 * as its own SNBT string — the housing-scoped click-action blob we cache by
 * action hash. Null if the item has none.
 */
export function extractInteractDataSnbt(itemSnbt: string): string | null {
    let tag: Tag;
    try {
        tag = htswNbt.parseSnbtText(itemSnbt);
    } catch (_e) {
        return null;
    }
    const interactData = getNestedCompound(tag, INTERACT_DATA_PATH);
    if (interactData === undefined) return null;
    return htswNbt.printSnbt(interactData, { pretty: false });
}

function ensureCompoundChild(parent: TagCompound, key: string): TagCompound {
    const existing = parent.value[key];
    if (existing !== undefined && existing.type === "compound") return existing;
    const created: TagCompound = { type: "compound", value: {} };
    parent.value[key] = created;
    return created;
}

/**
 * Build an item from a source cosmetic NBT with a cached `interact_data` blob
 * spliced back into `tag.ExtraAttributes.interact_data`. The inverse of
 * `extractInteractDataSnbt`: cosmetic + actions-blob → the real housing item.
 */
export function itemWithInteractData(cosmeticNbt: Tag, interactDataSnbt: string): Item {
    const root = cloneTag(cosmeticNbt);
    if (root.type === "compound") {
        const tagCompound = ensureCompoundChild(root, "tag");
        const extra = ensureCompoundChild(tagCompound, "ExtraAttributes");
        extra.value.interact_data = htswNbt.parseSnbtText(interactDataSnbt);
    }
    return getItemFromNbt(root);
}

/**
 * Whether an item carries the enchantment glint — a non-empty `tag.ench` list.
 * Function icons use the glint as a cosmetic flag, so which enchantment it is
 * doesn't matter; any entry counts. Inverse of `itemWithEnchantGlint`.
 */
export function itemHasEnchantGlint(item: Item): boolean {
    const tag = itemToHtswTag(item);
    const ench = getNestedTag(tag, ["tag", "ench"]);
    return ench !== undefined && ench.type === "list" && ench.value.value.length > 0;
}

/**
 * Rebuild an item with a sentinel enchantment so it renders the glint. MC shows
 * the glint for any non-empty `tag.ench`; the enchantment itself (Protection I)
 * is meaningless and never read back — only its presence is.
 */
export function itemWithEnchantGlint(item: Item): Item {
    const tag = itemToHtswTag(item);
    if (tag.type !== "compound") return item;
    const tagCompound = ensureCompoundChild(tag, "tag");
    tagCompound.value.ench = {
        type: "list",
        value: {
            type: "compound",
            value: [
                { id: { type: "short", value: 0 }, lvl: { type: "short", value: 1 } },
            ],
        },
    };
    return getItemFromNbt(tag);
}
