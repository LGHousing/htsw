export function stripFormatting(value: string): string {
    return value.replace(/[&§][0-9a-fk-or]/gi, "");
}

export function containsFormattingCode(value: string): boolean {
    return /[&§][0-9a-fk-or]/i.test(value);
}

export function ampToSection(value: string): string {
    return value.replace(/&([0-9a-fk-or])/gi, "§$1");
}

export function sectionToAmp(value: string): string {
    return value.replace(/§([0-9a-fk-or])/gi, "&$1");
}

export function partialEq(src: any, target: any): boolean {
    const keys = Object.keys(target);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (target[key] !== src[key]) return false;
    }
    return true;
}

export function nullableFn<T, R>(
    fn: (value: T) => R
): (value: T | undefined) => R | undefined {
    return (value: T | undefined) => {
        if (!value) return;
        return fn(value);
    };
}

/**
 * Minecraft's chat box silently drops every character the vanilla client
 * refuses to type — `ChatAllowedCharacters` allows only `c >= 0x20` with
 * `0x7F` (DEL) and `0xA7` (§) excluded. HTSW writes field values by building
 * a chat packet directly, which skips that filter, so an unfilterable
 * character reaches the server and the server answers by disconnecting the
 * player with "Illegal characters in chat" — killing the import mid-run.
 *
 * Returns the first offending character's index and code unit, or `null` when
 * the whole value is safe to send.
 */
export function findIllegalChatCharacter(
    value: string
): { index: number; code: number } | null {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x20 || code === 0x7f || code === 0xa7) {
            return { index: i, code };
        }
    }
    return null;
}

const CHAT_CHARACTER_NAMES: Record<number, string> = {
    0x00: "NUL",
    0x08: "backspace",
    0x09: "tab",
    0x0a: "newline",
    0x0d: "carriage return",
    0x1b: "escape",
    0x7f: "DEL",
    0xa7: "§ (section sign)",
};

/** Human-readable name for a code unit `findIllegalChatCharacter` rejected. */
export function describeCharCode(code: number): string {
    const hex = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
    const name = CHAT_CHARACTER_NAMES[code];
    return name === undefined ? hex : `${name} ${hex}`;
}
