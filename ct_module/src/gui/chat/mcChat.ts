/// <reference types="../../../CTAutocomplete" />

// The overlay scrollback mirrors Minecraft's own chat buffer so it shows the
// same messages — server chat, /htsw command output, AND printed diagnostics.
// CT's ChatLib.getChatLines() only exposes CT's inbound history (not our own
// ChatLib.chat output), so it's only a fallback if the direct read fails.
//
// Names verified against ctjs-2.2.1's bytecode (it edits the same buffer):
//   GuiNewChat.field_146253_i  drawnChatLines (already word-wrapped to MC's
//                              chat width — exactly vanilla wrapping)
//   GuiNewChat.field_146252_h  chatLines (raw, unwrapped; fallback)
//   ChatLine.func_151461_a() -> IChatComponent
//   IChatComponent.func_150254_d() -> formatted text (with § codes)
//
// We prefer drawnChatLines so long messages wrap like vanilla instead of
// running off the panel. Per wrapped message, MC stores its visual lines with
// the LAST line at the lowest index, so walking high->low index reverses each
// message's lines back into top-to-bottom order.
//
// NOTE: reflecting the List field surfaces it through Rhino as a Java Object[]
// (not a java.util.List), so we index it as an array — `.size()`/`.get()` are
// not available on the returned value. New lines are inserted at index 0, so
// index 0 is the NEWEST line.

const MAX_LINES = 100;
const LINE_FIELD_NAMES = ["field_146253_i", "field_146252_h"];

let lineField: any = null;
let lineFieldFailed = false;
let lastLen = -1;
let lastNewest = "";
let cacheLines: string[] = [];

function sameLines(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function replaceCache(lines: string[]): boolean {
    if (sameLines(cacheLines, lines)) return false;
    cacheLines = lines;
    return true;
}

function chatGuiFromMinecraft(): any | null {
    try {
        const ingame = (Client.getMinecraft() as any).field_71456_v;
        if (ingame === null || ingame === undefined) return null;
        const c = ingame.func_146158_b();
        return c === null || c === undefined ? null : c;
    } catch (_e) {
        return null;
    }
}

function chatGuiFromClient(): any | null {
    try {
        const c = (Client as any).getChatGUI();
        return c === null || c === undefined ? null : c;
    } catch (_e) {
        return null;
    }
}

// The chat-line list is a private field — resolve and cache the Field once,
// walking the class hierarchy (same reflection pattern as bounds.ts).
function reflectLineList(chat: any): any | null {
    if (lineField === null && !lineFieldFailed) {
        for (let n = 0; n < LINE_FIELD_NAMES.length && lineField === null; n++) {
            try {
                let klass = chat.getClass();
                while (klass !== null) {
                    try {
                        const f = klass.getDeclaredField(LINE_FIELD_NAMES[n]);
                        f.setAccessible(true);
                        lineField = f;
                        break;
                    } catch (_e) {
                        klass = klass.getSuperclass();
                    }
                }
            } catch (_e) {
                // try next name
            }
        }
        if (lineField === null) lineFieldFailed = true;
    }
    if (lineField === null) return null;
    try {
        return lineField.get(chat);
    } catch (_e) {
        return null;
    }
}

// The reflected value may be a Java Object[] (the common case here) or a
// java.util.List; support both.
function lengthOf(v: any): number {
    try {
        if (typeof v.size === "function") return Number(v.size());
    } catch (_e) {
        // not a List
    }
    try {
        if (typeof v.length === "number") return Number(v.length);
    } catch (_e) {
        // not an array
    }
    return -1;
}

function elementAt(v: any, i: number): any {
    try {
        if (typeof v.get === "function") return v.get(i);
    } catch (_e) {
        // not a List
    }
    try {
        return v[i];
    } catch (_e) {
        return null;
    }
}

function formattedTextOf(chatLine: any): string {
    try {
        if (chatLine === null || chatLine === undefined) return "";
        return String(chatLine.func_151461_a().func_150254_d());
    } catch (_e) {
        return "";
    }
}

function mcChatList(): { list: any; len: number } | null {
    let chat = chatGuiFromMinecraft();
    if (chat === null) chat = chatGuiFromClient();
    if (chat === null) return null;

    const list = reflectLineList(chat);
    if (list === null) return null;

    const len = lengthOf(list);
    if (len < 0) return null;
    return { list, len };
}

// Index 0 is newest. Walk newest->oldest over the most recent MAX_LINES,
// pushing to build an oldest-first array; trailing nulls (an ArrayList's
// unused capacity slots sit at the high indices) are skipped.
function buildMcLines(list: any, len: number): string[] | null {
    const limit = Math.min(len, MAX_LINES);
    const lines: string[] = [];
    let nonEmpty = 0;
    for (let i = limit - 1; i >= 0; i--) {
        const el = elementAt(list, i);
        if (el === null || el === undefined) continue;
        const s = formattedTextOf(el);
        if (s.length > 0) nonEmpty++;
        lines.push(s);
    }
    if (nonEmpty === 0) return null;
    return lines;
}

// CT's ClientListener history (inbound only). Returns oldest-first.
function readCtFallback(): string[] | null {
    try {
        const raw: any = ChatLib.getChatLines();
        if (raw === null || raw === undefined) return null;
        const n = typeof raw.length === "number" ? raw.length : Number(raw.size());
        const limit = Math.min(n, MAX_LINES);
        const lines: string[] = [];
        for (let i = limit - 1; i >= 0; i--) {
            lines.push(String(typeof raw.length === "number" ? raw[i] : raw.get(i)));
        }
        return lines;
    } catch (_e) {
        return null;
    }
}

/**
 * The most recent chat lines, OLDEST-FIRST (newest at the end), formatted with
 * `§` color codes intact. Safe to call every frame: a change probe (line count
 * + newest line's text) skips the full rebuild on unchanged frames, so a new
 * message shows within a frame instead of on a fixed interval. Returns the last
 * good snapshot when every source is briefly unreachable.
 */
export function refreshChatLines(): boolean {
    const mc = mcChatList();
    if (mc === null) {
        const fb = readCtFallback();
        if (fb === null) return false;
        return replaceCache(fb);
    }

    const newest = mc.len > 0 ? formattedTextOf(elementAt(mc.list, 0)) : "";
    if (mc.len === lastLen && newest === lastNewest && cacheLines.length > 0) {
        return false;
    }

    const lines = buildMcLines(mc.list, mc.len);
    if (lines === null) return false;

    lastLen = mc.len;
    lastNewest = newest;
    return replaceCache(lines);
}

export function getChatLines(): string[] {
    refreshChatLines();
    return cacheLines;
}
