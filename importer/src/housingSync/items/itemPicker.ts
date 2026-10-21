// Client module: declared here, implemented by the client (ct_module/src/housingSync/items/itemPicker.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type TaskContext from "../../tasks/context";
import type { Item, MCItemStack } from "../../platform";

export type StackMatcher = (left: MCItemStack, right: MCItemStack) => boolean;

export declare function setItemValue(
    ctx: TaskContext,
    fieldName: string,
    item: Item,
    match?: StackMatcher
): Promise<void>;
export declare function selectItemFromOpenInventory(
    ctx: TaskContext,
    item: Item,
    label: string,
    match?: StackMatcher,
    onMutationStarted?: () => void
): Promise<void>;
