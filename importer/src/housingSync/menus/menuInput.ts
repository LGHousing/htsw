// Client module: declared here, implemented by the client (ct_module/src/housingSync/menus/menuInput.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
// Typing a value into Housing's anvil and sign prompts.

/** Put a paper named `newName` in the open anvil's output slot. */
export declare function setAnvilItemName(newName: string): void;
/** Take the anvil's output item, which submits the name. */
export declare function acceptNewAnvilItem(): void;
export declare function isSignEditorOpen(): boolean;
/** Write `value` on the open sign's first line and close the editor, which sends it. */
export declare function submitSignValue(value: string): void;
