/// <reference types="../../../CTAutocomplete" />

import {
    getMinecraft,
    javaArrayAt,
    javaArrayLength,
} from "../lib/java";

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

let lineField: HtswJavaReflectField | null = null;
let lineFieldFailed = false;
let lastLen = -1;
let lastNewest = "";
let cacheLines: string[] = [];
let lastProbeAt = 0;

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

function chatGuiFromMinecraft(): HtswMinecraftChatGui | null {
    try {
        const ingame = getMinecraft().field_71456_v;
        if (ingame === null) return null;
        return ingame.func_146158_b();
    } catch (_e) {
        return null;
    }
}

function chatGuiFromClient(): HtswMinecraftChatGui | null {
    try {
        return (
            Client as unknown as {
                getChatGUI(): HtswMinecraftChatGui | null;
            }
        ).getChatGUI();
    } catch (_e) {
        return null;
    }
}

// The chat-line list is a private field — resolve and cache the Field once,
// walking the class hierarchy (same reflection pattern as bounds.ts).
function reflectLineList(chat: HtswMinecraftChatGui): unknown {
    if (lineField === null && !lineFieldFailed) {
        for (let n = 0; n < LINE_FIELD_NAMES.length && lineField === null; n++) {
            try {
                let klass: HtswJavaClass | null = chat.getClass();
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

function formattedTextOf(chatLine: unknown): string {
    try {
        if (chatLine === null || chatLine === undefined) return "";
        const line = chatLine as {
            func_151461_a(): { func_150254_d(): string };
        };
        const text: unknown = line.func_151461_a().func_150254_d();
        return String(text);
    } catch (_e) {
        return "";
    }
}

function mcChatList(): { list: unknown; len: number } | null {
    let chat = chatGuiFromMinecraft();
    if (chat === null) chat = chatGuiFromClient();
    if (chat === null) return null;

    const list = reflectLineList(chat);
    if (list === null) return null;

    const len = javaArrayLength(list);
    if (len < 0) return null;
    return { list, len };
}

// Index 0 is newest. Walk newest->oldest over the most recent MAX_LINES,
// pushing to build an oldest-first array; trailing nulls (an ArrayList's
// unused capacity slots sit at the high indices) are skipped.
function buildMcLines(list: unknown, len: number): string[] | null {
    const limit = Math.min(len, MAX_LINES);
    const lines: string[] = [];
    let nonEmpty = 0;
    for (let i = limit - 1; i >= 0; i--) {
        const el = javaArrayAt(list, i);
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
        const raw = (
            ChatLib as unknown as {
                getChatLines(): unknown;
            }
        ).getChatLines();
        if (raw === null || raw === undefined) return null;
        const n = javaArrayLength(raw);
        const limit = Math.min(n, MAX_LINES);
        const lines: string[] = [];
        for (let i = limit - 1; i >= 0; i--) {
            lines.push(String(javaArrayAt(raw, i)));
        }
        return lines;
    } catch (_e) {
        return null;
    }
}

/**
 * The most recent chat lines, OLDEST-FIRST (newest at the end), formatted with
 * `§` color codes intact. Safe to call every frame: a change probe runs at most
 * every 100ms while a snapshot exists and skips the full rebuild when unchanged.
 * Returns the last
 * good snapshot when every source is briefly unreachable.
 */
export function refreshChatLines(): boolean {
    const now = Date.now();
    if (cacheLines.length > 0 && now - lastProbeAt < 100) return false;
    lastProbeAt = now;
    const mc = mcChatList();
    if (mc === null) {
        const fb = readCtFallback();
        if (fb === null) return false;
        return replaceCache(fb);
    }

    const newest = mc.len > 0 ? formattedTextOf(javaArrayAt(mc.list, 0)) : "";
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
