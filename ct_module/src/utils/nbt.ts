import type { Tag } from "htsw/nbt";

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

export function getItemFromNbt(nbt: Tag): Item {
    const mcTag = toMinecraftTag(nbt);

    // @ts-ignore STUPID TYPEDEF!
    const itemStack = ItemStack.func_77949_a/*loadItemStackFromNBT*/(mcTag);

    return new Item(itemStack);
}