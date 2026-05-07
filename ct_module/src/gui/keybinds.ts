/// <reference types="../../CTAutocomplete" />

// Registering a `KeyBind` with a category surfaces it in MC's Options →
// Controls menu, so the user can rebind it. Construction happens at module
// load — that's fine because by the time any HTSW JS executes, MC and CT
// are fully initialized and the key-bindings list exists.
const chatKeyBind = new KeyBind("Focus HTSW chat input", Keyboard.KEY_T, "HTSW");

export function getChatKeyCode(): number {
    return chatKeyBind.getKeyCode();
}

/** Display name like "T" or "LSHIFT". Returns "(unbound)" when MC's controls
 *  menu has the binding cleared. */
export function getChatKeyName(): string {
    const code = chatKeyBind.getKeyCode();
    if (code <= 0) return "(unbound)";
    const name = Keyboard.getKeyName(code);
    if (name === null || name === "NONE") return "(unbound)";
    return name;
}
