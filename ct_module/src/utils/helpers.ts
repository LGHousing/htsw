export function removedFormatting(str: string): string {
    return str.replace(/(?:§|&)[0-9a-fklmnor]/g, "");
}

export function normalizeFormattingCodes(str: string): string {
    return str.replace(/§([0-9a-fklmnor])/gi, "&$1");
}

export function chatWidth(string: string): number {
    const raw = ChatLib.removeFormatting(ChatLib.replaceFormatting(string));
    return Client.getMinecraft().field_71466_p.func_78256_a(raw);
}

export function spaceWidth() {
    return chatWidth(" ");
}

export function chatSeparator(): string {
    const totalWidth = ChatLib.getChatWidth();
    const sepWidth = chatWidth("-");

    return "-".repeat(totalWidth / sepWidth);
}

export function cyrb53(str: string, seed: number = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};
