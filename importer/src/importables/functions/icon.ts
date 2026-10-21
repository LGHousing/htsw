// Client module: declared here, implemented by the client (ct_module/src/importables/functions/icon.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type { FunctionIcon } from "htsw/types";

import type { Item, MCItemStack } from "../../platform";

export type FunctionIconSnapshot = { item: string; count: number; enchanted: boolean };

export declare function snapshotIconStack(
    stack: MCItemStack | null | undefined
): FunctionIconSnapshot | null;
export declare function createIconItem(icon: FunctionIcon): Item;
export declare function functionIconFromSnapshot(
    snapshot: FunctionIconSnapshot | null
): FunctionIcon | undefined;
export declare function iconStacksEqual(
    a: MCItemStack | null | undefined,
    b: MCItemStack | null | undefined
): boolean;
