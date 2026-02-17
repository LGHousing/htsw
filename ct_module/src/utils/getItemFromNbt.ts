const JsonToNBT = Java.type(
    "net.minecraft.nbt.JsonToNBT"
);

export function getItemFromNbt(nbtStr: string): Item {
    const nbt = JsonToNBT.func_180713_a(nbtStr);
    const count = nbt.func_74771_c("Count");
    const id = nbt.func_74779_i("id");
    const damage = nbt.func_74765_d("Damage");
    const tag = nbt.func_74781_a("tag");
    let item = new Item(id);
    item.setStackSize(count);
    let itemStack = item.getItemStack();
    itemStack.func_77964_b(damage);
    if (tag) itemStack.func_77982_d(tag);
    item = new Item(itemStack);
    return item;
}
