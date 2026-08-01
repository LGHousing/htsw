/// <reference types="../../../CTAutocomplete" />

import {
    Element,
    SCROLLBAR_WIDTH,
    clearUserScrollOverride,
    getScrollState,
    isScrollUserOverridden,
    setScrollOffset,
} from "../lib/layout";
import { Col, Container, Input, Scroll, Text } from "../lib/components";
import {
    ACCENT_INFO,
    COLOR_INPUT_BG,
    COLOR_PANEL,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
} from "../lib/theme";
import { setFocusedInput } from "../lib/focus";
import { getChatKeyName } from "../keybinds";
import { isSimulatorActive } from "../../simulator/session";
import { getChatLines } from "./mcChat";
import {
    getMinecraft,
    javaArrayAt,
    javaArrayLength,
    runtimeString,
    type RuntimeString,
} from "../lib/java";

export const CHAT_INPUT_ID = "htsw-chat-input";
const CHAT_SCROLL_ID = "htsw-chat-scroll";
const CHAT_INPUT_H = 16;
const CHAT_SCROLL_PAD_LEFT = 4;
const CHAT_SCROLL_PAD_RIGHT = 0;

let chatText = "";

const SENT_HISTORY_MAX = 100;
const sentHistory: string[] = [];
// Index into sentHistory while browsing with up/down; -1 = not browsing.
let historyPos = -1;
// What was typed before browsing started; restored when stepping past the
// newest history entry, like vanilla chat.
let historyDraft = "";

function rememberSentMessage(text: string): void {
    if (sentHistory[sentHistory.length - 1] !== text) {
        sentHistory.push(text);
        if (sentHistory.length > SENT_HISTORY_MAX) sentHistory.shift();
    }
    historyPos = -1;
    historyDraft = "";
}

function stepHistory(delta: number): void {
    if (sentHistory.length === 0) return;
    if (historyPos === -1) {
        if (delta > 0) return;
        historyDraft = chatText;
        historyPos = sentHistory.length - 1;
    } else {
        const next = historyPos + delta;
        if (next < 0) return;
        if (next >= sentHistory.length) {
            historyPos = -1;
            chatText = historyDraft;
            return;
        }
        historyPos = next;
    }
    chatText = sentHistory[historyPos];
}

const KEY_UP = 200;
const KEY_DOWN = 208;

function handleChatKey(keyCode: number): boolean {
    if (keyCode !== KEY_UP && keyCode !== KEY_DOWN) return false;
    stepHistory(keyCode === KEY_UP ? -1 : 1);
    return true;
}

function commandNameOf(text: string): string {
    if (text.substring(0, 2) === "//") return "/";
    const withoutSlash = text.substring(1).trim();
    const space = withoutSlash.indexOf(" ");
    return (space === -1 ? withoutSlash : withoutSlash.substring(0, space))
        .toLowerCase();
}

function isClientCommand(text: string): boolean {
    const name = commandNameOf(text);
    if (
        name === "htsw" ||
        name === "import" ||
        name === "export" ||
        name === "simulator" ||
        name === "sim"
    ) {
        return true;
    }

    return isSimulatorActive() && (
        name === "function" ||
        name === "var" ||
        name === "eval" ||
        name === "/"
    );
}

function submitChat(): void {
    const text = chatText.trim();
    if (text.length === 0) {
        setFocusedInput(null);
        return;
    }
    try {
        if (text.charAt(0) === "/" && isClientCommand(text)) {
            ChatLib.command(text.substring(1), true);
        } else {
            ChatLib.say(text);
        }
    } catch (err) {
        ChatLib.chat(`&c[htsw] Send failed: ${String(err)}`);
    }
    rememberSentMessage(text);
    chatText = "";
    setFocusedInput(null);
}

// Keep the scrollback pinned to the newest message unless the user has
// scrolled up to read history; resume following the moment they scroll back
// to the bottom. Mirrors vanilla chat. Runs while building rows, so it acts
// on the previous frame's measured content/viewport — a one-frame lag that
// converges immediately.
function stickScrollbackToBottom(): void {
    const s = getScrollState(CHAT_SCROLL_ID);
    const maxOffset = Math.max(0, s.contentLength - s.viewportRect.h);
    if (isScrollUserOverridden(CHAT_SCROLL_ID)) {
        if (s.target >= maxOffset - 1) {
            clearUserScrollOverride(CHAT_SCROLL_ID);
            setScrollOffset(CHAT_SCROLL_ID, maxOffset);
        }
        return;
    }
    setScrollOffset(CHAT_SCROLL_ID, maxOffset);
}

function wrapFormattedLine(line: string, maxWidth: number): string[] {
    if (maxWidth <= 0) return [line];
    let wrapped: unknown;
    try {
        const font = getMinecraft().field_71466_p;
        wrapped = font.func_78271_c(line, Math.floor(maxWidth));
    } catch (_e) {
        return [line];
    }
    const n = javaArrayLength(wrapped);
    if (n <= 0) return [line];
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
        const part = javaArrayAt(wrapped, i) as RuntimeString | null | undefined;
        if (part !== null && part !== undefined) out.push(runtimeString(part));
    }
    return out.length === 0 ? [line] : out;
}

function chatRows(wrapWidth: number): Element[] {
    const lines = getChatLines();
    stickScrollbackToBottom();
    if (lines.length === 0) {
        return [
            Text({
                text: `No messages yet — press ${getChatKeyName()} to chat`,
                color: COLOR_TEXT_FAINT,
                style: { width: { kind: "grow" } },
            }),
        ];
    }
    const rows: Element[] = [];
    for (let i = 0; i < lines.length; i++) {
        // No `color`: Renderer.drawString honors the line's own § codes.
        const wrapped = wrapFormattedLine(lines[i], wrapWidth);
        for (let j = 0; j < wrapped.length; j++) {
            rows.push(Text({ text: wrapped[j], style: { width: { kind: "grow" } } }));
        }
    }
    return rows;
}

function ChatInputBar(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 4 },
            gap: 6,
            width: { kind: "grow" },
            height: { kind: "px", value: CHAT_INPUT_H },
            background: COLOR_INPUT_BG,
        },
        children: [
            Text({
                text: "›",
                color: ACCENT_INFO,
                style: { width: { kind: "px", value: 8 } },
            }),
            Input({
                id: CHAT_INPUT_ID,
                value: () => chatText,
                onChange: (v) => { chatText = v; },
                onSubmit: () => submitChat(),
                onKeyDown: (keyCode) => handleChatKey(keyCode),
                placeholder: `Press ${getChatKeyName()} to chat…`,
                style: { width: { kind: "grow" } },
            }),
            Text({
                text: "Enter ↵",
                color: COLOR_TEXT_DIM,
            }),
        ],
    });
}

/**
 * Full chat surface for the bottom of the left column: a vanilla-style
 * scrollback (reads MC's own chat buffer, so server messages, command
 * output, and diagnostics all appear) above the chat input bar.
 */
export function ChatPanel(width: number, height: number): Element {
    const wrapWidth = Math.max(
        0,
        width - CHAT_SCROLL_PAD_LEFT - CHAT_SCROLL_PAD_RIGHT - SCROLLBAR_WIDTH
    );
    return Col({
        style: {
            width: { kind: "grow" },
            height: { kind: "px", value: Math.max(0, height) },
            background: COLOR_PANEL,
        },
        children: [
            Scroll({
                id: CHAT_SCROLL_ID,
                axis: "y",
                style: {
                    direction: "col",
                    gap: 1,
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    padding: [
                        { side: "left", value: CHAT_SCROLL_PAD_LEFT },
                        { side: "right", value: CHAT_SCROLL_PAD_RIGHT },
                        { side: "top", value: 3 },
                        { side: "bottom", value: 3 },
                    ],
                },
                children: () => chatRows(wrapWidth),
            }),
            ChatInputBar(),
        ],
    });
}
