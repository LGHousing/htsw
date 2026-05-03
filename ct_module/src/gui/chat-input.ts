/// <reference types="../../CTAutocomplete" />

import { Element } from "./lib/layout";
import { Container, Input, Text } from "./lib/components";
import { ACCENT_INFO, COLOR_INPUT_BG, COLOR_TEXT_DIM } from "./lib/theme";
import { setFocusedInput } from "./lib/focus";

export const CHAT_INPUT_ID = "htsw-chat-input";

let chatText = "";

export function getChatText(): string {
    return chatText;
}

export function setChatText(v: string): void {
    chatText = v;
}

export function focusChatInput(): void {
    setFocusedInput(CHAT_INPUT_ID);
}

/**
 * Send the current input text to chat and clear the field.
 *
 * Distinguishes commands (lines starting with "/") from messages — commands
 * route through `ChatLib.command` which fires them as the player. Messages
 * use `ChatLib.say` which is the same as typing in the vanilla chat.
 */
export function submitChat(): void {
    const text = chatText.trim();
    if (text.length === 0) return;
    try {
        if (text.startsWith("/")) {
            ChatLib.command(text.substring(1));
        } else {
            ChatLib.say(text);
        }
    } catch (err) {
        ChatLib.chat(`&c[htsw] Send failed: ${err}`);
    }
    chatText = "";
    setFocusedInput(null);
}

export function ChatInputBar(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 4 },
            gap: 6,
            width: { kind: "grow" },
            height: { kind: "grow" },
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
                placeholder: "Press T to chat…",
                style: { width: { kind: "grow" } },
            }),
            Text({
                text: "Enter ↵",
                color: COLOR_TEXT_DIM,
            }),
        ],
    });
}

