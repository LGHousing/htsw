// Client module: declared here, implemented by the client (ct_module/src/housingSync/items/capture.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type TaskContext from "../../tasks/context";
import type { ItemFieldObservation } from "./fieldObservations";

export interface ItemCaptureSink {
    register(snbt: string, displayNameHint: string): string;
    registerBlockReference(snbt: string, displayNameHint: string): string;
}

export declare function captureItemFromOpenEditorField(
    ctx: TaskContext,
    fieldName: string,
    captures: Pick<ItemCaptureSink, "register">,
    displayNameHint: string
): Promise<string | null>;
export declare function captureBlockReferenceFromOpenEditorField(
    ctx: TaskContext,
    fieldName: string,
    captures: Pick<ItemCaptureSink, "registerBlockReference">,
    displayNameHint: string
): Promise<string | null>;
export declare function observeItemFromOpenEditorField(
    ctx: TaskContext,
    fieldName: string,
    displayNameHint: string
): Promise<ItemFieldObservation | null>;
