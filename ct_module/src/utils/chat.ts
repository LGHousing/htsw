import { helpers } from "htsw";

import { javaType } from "./java";

// ChatTriggers 2.2.1 runs every string given to TextComponent (and so to
// ChatLib.chat) through a parser that auto-links any `word.letters` token as a
// white open_url sibling. Its colour-code check is broken, so the code letter
// before the token is swallowed into the link: `&ffrick.snbt` renders as
// `rffrick.snbt`, and every file name in a path trips it. Building the
// ChatComponentText directly skips the parser; the font renderer still reads
// the `§` codes.

/** A component carrying `text` exactly as given: no colour conversion, no
 * URL detection. `§` codes in it still render as formatting. */
export function rawComponent(text: string): TextComponent {
    const ChatComponentText = javaType("net.minecraft.util.ChatComponentText");
    return new TextComponent(new ChatComponentText(text) as unknown as MCIChatComponent);
}

/** `rawComponent` after `&x` → `§x`, for text that uses `&` colour codes. */
export function colouredComponent(text: string): TextComponent {
    return rawComponent(helpers.ampToSection(text));
}

/** Chat one line built from `&`-coloured strings and ready-made components,
 * none of which CT gets to reparse. */
export function chatLine(...parts: (string | TextComponent)[]): void {
    const components: TextComponent[] = [];
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        components.push(typeof part === "string" ? colouredComponent(part) : part);
    }
    ChatLib.chat(new Message(components));
}
