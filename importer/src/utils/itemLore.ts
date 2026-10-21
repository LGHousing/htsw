// Client module: declared here, implemented by the client (ct_module/src/utils/itemLore.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type { Item } from "../platform";

export declare function itemLore(item: Item): string[];
