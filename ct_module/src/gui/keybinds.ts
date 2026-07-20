/// <reference types="../../CTAutocomplete" />

import { getMinecraft } from "./lib/java";

function getMinecraftChatKeyBinding(): HtswMinecraftKeyBinding | null {
    try {
        const settings = getMinecraft().field_71474_y;
        if (settings === null) return null;
        return settings.field_74310_D;
    } catch (_e) {
        return null;
    }
}

function getMinecraftInventoryKeyBinding(): HtswMinecraftKeyBinding | null {
    try {
        const settings = getMinecraft().field_71474_y;
        if (settings === null) return null;
        return settings.field_151445_Q;
    } catch (_e) {
        return null;
    }
}

function keyCodeOf(binding: HtswMinecraftKeyBinding): number | null {
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

export function getInventoryKeyCode(): number {
    const binding = getMinecraftInventoryKeyBinding();
    if (binding === null) return Keyboard.KEY_E;
    const code = keyCodeOf(binding);
    return code === null ? Keyboard.KEY_E : code;
}

/** Display name like "T" or "LSHIFT". Returns "(unbound)" when MC's controls
 *  menu has the binding cleared. */
export function getChatKeyName(): string {
    const code = getChatKeyCode();
    if (code <= 0) return "(unbound)";
    const name: unknown = Keyboard.getKeyName(code);
    if (name === null || name === "NONE") return "(unbound)";
    return typeof name === "string" ? name : "(unbound)";
}
