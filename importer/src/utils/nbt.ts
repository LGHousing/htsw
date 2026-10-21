// Client module: declared here, implemented by the client (ct_module/src/utils/nbt.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type { Tag } from "htsw/nbt";

import type { Item, MCItemStack } from "../platform";

export declare function itemToHtswTag(item: Item): Tag;
export declare function getItemFromNbt(nbt: Tag): Item;
export declare function getItemFromSnbt(snbt: string): Item;
export declare function readItemDisplayAliases(nbt: Tag): string[];
export declare function extractInteractDataSnbt(itemSnbt: string): string | null;
export declare function itemWithInteractData(
    cosmeticNbt: Tag,
    interactDataSnbt: string
): Item;
export declare function itemStackRawNbt(stack: MCItemStack): string;
