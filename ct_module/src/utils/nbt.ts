import type { Tag, TagCompound } from "htsw/nbt";
import { removedFormatting } from "./helpers";

const NBTTagByte = Java.type("net.minecraft.nbt.NBTTagByte");
const NBTTagShort = Java.type("net.minecraft.nbt.NBTTagShort");
const NBTTagInt = Java.type("net.minecraft.nbt.NBTTagInt");
const NBTTagLong = Java.type("net.minecraft.nbt.NBTTagLong");
const NBTTagFloat = Java.type("net.minecraft.nbt.NBTTagFloat");
const NBTTagDouble = Java.type("net.minecraft.nbt.NBTTagDouble");
const NBTTagString = Java.type("net.minecraft.nbt.NBTTagString");
const NBTTagList = Java.type("net.minecraft.nbt.NBTTagList");
const NBTTagCompound = Java.type("net.minecraft.nbt.NBTTagCompound");
const NBTTagByteArray = Java.type("net.minecraft.nbt.NBTTagByteArray");
const NBTTagIntArray = Java.type("net.minecraft.nbt.NBTTagIntArray");
const JLong = Java.type("java.lang.Long");

function tagFromListElement(type: Tag["type"], value: Tag["value"]): Tag {
    return { type, value } as Tag;
}

function toJavaLong(value: any): any {
    return JLong.valueOf(value.toString());
}

export function toMinecraftTag(tag: Tag): any {
    if (tag.type === "byte") return new NBTTagByte(tag.value);
    if (tag.type === "short") return new NBTTagShort(tag.value);
    if (tag.type === "int") return new NBTTagInt(tag.value);
    if (tag.type === "long") return new NBTTagLong(toJavaLong(tag.value));
    if (tag.type === "float") return new NBTTagFloat(tag.value);
    if (tag.type === "double") return new NBTTagDouble(tag.value);
    if (tag.type === "string") return new NBTTagString(tag.value);

    if (tag.type === "list") {
        const listTag = new NBTTagList();
        for (const value of tag.value.value) {
            listTag.func_74742_a(
                toMinecraftTag(tagFromListElement(tag.value.type, value))
            );
        }
        return listTag;
    }

    if (tag.type === "compound") {
        const compoundTag = new NBTTagCompound();
        for (const key of Object.keys(tag.value)) {
            const child = tag.value[key];
            if (child === undefined) continue;
            compoundTag.func_74782_a(key, toMinecraftTag(child));
        }
        return compoundTag;
    }

    if (tag.type === "byte_array") {
        return new NBTTagByteArray((Java as any).to(tag.value, "byte[]"));
    }

    if (tag.type === "int_array") {
        return new NBTTagIntArray((Java as any).to(tag.value, "int[]"));
    }

    // as list for now
    const listTag = new NBTTagList();
    if (tag.type === "short_array") {
        for (const value of tag.value) {
            listTag.func_74742_a(new NBTTagShort(value));
        }
        return listTag;
    }
    if (tag.type === "long_array") {
        for (const value of tag.value) {
            listTag.func_74742_a(new NBTTagLong(toJavaLong(value)));
        }
        return listTag;
    }
}

const ItemStack = Java.type("net.minecraft.item.ItemStack");
const JsonToNBT = Java.type("net.minecraft.nbt.JsonToNBT");

export function getItemFromNbt(nbt: Tag): Item {
    const mcTag = toMinecraftTag(normalizeItemNbtColorCodes(nbt));

    // @ts-ignore STUPID TYPEDEF!
    const itemStack = ItemStack.func_77949_a(/*loadItemStackFromNBT*/ mcTag);

    return new Item(itemStack);
}

/**
 * Parse a Minecraft SNBT string (the format `Item.getRawNBT()` returns) into
 * a spawnable Item. Used to materialize cached, post-/edit item snapshots
 * from `./htsw/.cache/<uuid>/items/<hash>.snbt` for fields like GIVE_ITEM
 * that need the housing-tagged version of an item, not its raw source NBT.
 */
export function getItemFromSnbt(snbt: string): Item {
    // @ts-ignore STUPID TYPEDEF!
    const compound = JsonToNBT.func_180713_a(/*parseStringIntoCompound*/ snbt);
    // @ts-ignore STUPID TYPEDEF!
    const itemStack = ItemStack.func_77949_a(/*loadItemStackFromNBT*/ compound);
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

    for (const key of Object.keys(normalizedDisplay.value)) {
        const child = normalizedDisplay.value[key];
        if (child === undefined) {
            continue;
        }

        normalizedDisplay.value[key] = normalizeFormattingStringTags(child);
    }

    return normalized;
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
    for (const segment of path) {
        if (current?.type !== "compound") {
            return undefined;
        }
        current = current.value[segment];
    }
    return current;
}

function cloneTag(tag: Tag): Tag {
    if (tag.type === "compound") {
        const value: Record<string, Tag | undefined> = {};
        for (const key of Object.keys(tag.value)) {
            const child = tag.value[key];
            value[key] = child === undefined ? undefined : cloneTag(child);
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
