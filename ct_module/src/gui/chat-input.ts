/// <reference types="../../CTAutocomplete" />

import { Element } from "./lib/layout";
import { Container, Input, Text } from "./lib/components";
import { ACCENT_INFO, COLOR_INPUT_BG, COLOR_TEXT_DIM } from "./lib/theme";
import { setFocusedInput } from "./lib/focus";
import { getChatKeyName } from "./keybinds";
import { Simulator } from "../simulator/simulator";

export const CHAT_INPUT_ID = "htsw-chat-input";

let chatText = "";

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

    return Simulator.isActive && (
        name === "function" ||
        name === "var" ||
        name === "eval" ||
        name === "/"
    );
}

function submitChat(): void {
    const text = chatText.trim();
    if (text.length === 0) return;
    try {
        if (text.charAt(0) === "/" && isClientCommand(text)) {
            ChatLib.command(text.substring(1), true);
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

