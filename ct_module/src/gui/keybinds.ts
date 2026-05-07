/// <reference types="../../CTAutocomplete" />

function getMinecraftChatKeyBinding(): any | null {
    try {
        const settings = Client.getMinecraft().field_71474_y;
        if (settings === null || settings === undefined) return null;
        const binding = settings.field_74310_D;
        return binding === undefined ? null : binding;
    } catch (_e) {
        return null;
    }
}

function keyCodeOf(binding: any): number | null {
    try {
        return Number(binding.func_151463_i());
    } catch (_e) {
        try {
            return Number(binding.getKeyCode());
        } catch (_inner) {
            return null;
        }
    }
}

export function getChatKeyCode(): number {
    const binding = getMinecraftChatKeyBinding();
    if (binding === null) return Keyboard.KEY_T;
    const code = keyCodeOf(binding);
    return code === null ? Keyboard.KEY_T : code;
}

/** Display name like "T" or "LSHIFT". Returns "(unbound)" when MC's controls
 *  menu has the binding cleared. */
export function getChatKeyName(): string {
    const code = getChatKeyCode();
    if (code <= 0) return "(unbound)";
    const name = Keyboard.getKeyName(code);
    if (name === null || name === "NONE") return "(unbound)";
    return name;
}
