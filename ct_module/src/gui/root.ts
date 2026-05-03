/// <reference types="../../CTAutocomplete" />

import { Element } from "./lib/layout";
import { Col, Container, Row } from "./lib/components";
import {
    SCREEN_PAD,
    TOP_BAR_H,
    getChatBounds,
    getContainerBounds,
    type ContainerBounds,
} from "./lib/bounds";
import { TopBar } from "./top-bar";
import { LeftPanel } from "./left-panel";
import { RightPanel } from "./right-panel";
import { BottomToolbar } from "./bottom-toolbar";
import { ChatInputBar } from "./chat-input";

const COLOR_PANEL = 0xf0242931 | 0;
const CHAT_INPUT_H = 16;

function bgPad(h: number): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "px", value: Math.max(0, h) },
            background: COLOR_PANEL,
        },
        children: [],
    });
}

function transparentPad(h: number): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "px", value: Math.max(0, h) },
        },
        children: [],
    });
}

function bgWrap(child: Element, height: number | "grow"): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height:
                height === "grow"
                    ? { kind: "grow" }
                    : { kind: "px", value: Math.max(0, height) },
            background: COLOR_PANEL,
        },
        children: [child],
    });
}

function buildLayout(b: ContainerBounds): Element {
    const chat = getChatBounds(b);
    const panelTop = SCREEN_PAD;
    const contentRowY = panelTop + TOP_BAR_H;
    const leftColW = Math.max(0, b.left - SCREEN_PAD);
    const centerColW = b.xSize;
    const rightColW = Math.max(0, b.screenW - SCREEN_PAD - (b.left + b.xSize));

    const topGapH = Math.max(0, b.top - contentRowY);
    const contentRowH = Math.max(0, b.screenH - SCREEN_PAD - contentRowY);
    const leftColBottom = contentRowY + contentRowH;
    const chatTopInLeftCol = Math.max(0, chat.y - contentRowY);
    const chatSpacerH = Math.max(0, Math.min(leftColBottom - chat.y, chat.h));
    // The chat input bar sits just above the chat cutout in the left column;
    // its height eats into the rail's available space.
    const chatInputH = chatTopInLeftCol >= CHAT_INPUT_H + 20 ? CHAT_INPUT_H : 0;
    const railH = Math.max(0, chatTopInLeftCol - chatInputH);

    return Col({
        style: { width: { kind: "grow" }, height: { kind: "grow" } },
        children: [
            // TOP BAR
            Container({
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: TOP_BAR_H },
                    background: COLOR_PANEL,
                },
                children: [TopBar()],
            }),
            // CONTENT ROW
            Row({
                style: { width: { kind: "grow" }, height: { kind: "grow" } },
                children: [
                    // LEFT COLUMN
                    Col({
                        style: {
                            width: { kind: "px", value: leftColW },
                            height: { kind: "grow" },
                        },
                        children: [
                            bgWrap(LeftPanel(), railH),
                            // Inline chat input — only rendered if there's
                            // room without crushing the rail.
                            chatInputH > 0
                                ? Container({
                                      style: {
                                          width: { kind: "grow" },
                                          height: { kind: "px", value: chatInputH },
                                          background: COLOR_PANEL,
                                      },
                                      children: [ChatInputBar()],
                                  })
                                : false,
                            // CHAT CUTOUT
                            transparentPad(chatSpacerH),
                        ],
                    }),
                    // CENTER COLUMN
                    Col({
                        style: {
                            width: { kind: "px", value: centerColW },
                            height: { kind: "grow" },
                        },
                        children: [
                            bgPad(topGapH),
                            // CONTAINER CUTOUT
                            transparentPad(b.ySize),
                            // Bottom toolbar
                            bgWrap(BottomToolbar(), "grow"),
                        ],
                    }),
                    // RIGHT COLUMN
                    Container({
                        style: {
                            width: { kind: "px", value: rightColW },
                            height: { kind: "grow" },
                            background: COLOR_PANEL,
                        },
                        children: [RightPanel()],
                    }),
                ],
            }),
        ],
    });
}

export function RootTree(): Element {
    return Container({
        style: { width: { kind: "grow" }, height: { kind: "grow" } },
        children: () => {
            const b = getContainerBounds();
            if (b === null) return [];
            return [buildLayout(b)];
        },
    });
}
