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
import { LiveImporter } from "./live-importer";
import { getImportProgress } from "./state";
import { COLOR_PANEL, COLOR_PANEL_BORDER } from "./lib/theme";

const CHAT_INPUT_H = 16;

function transparentPad(h: number): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "px", value: Math.max(0, h) },
        },
        children: [],
    });
}

function stablePanel(h: number): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "px", value: Math.max(0, h) },
            background: COLOR_PANEL,
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

let cachedImportBounds: ContainerBounds | null = null;

function getStableBounds(): ContainerBounds | null {
    const live = getContainerBounds();
    const importing = getImportProgress() !== null;
    if (!importing) {
        cachedImportBounds = null;
        return live;
    }
    if (live !== null) {
        if (cachedImportBounds === null) {
            cachedImportBounds = live;
        } else {
            cachedImportBounds = {
                ...cachedImportBounds,
                screenW: live.screenW,
                screenH: live.screenH,
            };
        }
    }
    return cachedImportBounds ?? live;
}

function buildLayout(b: ContainerBounds): Element {
    const importing = getImportProgress() !== null;
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

    // Compact above-menu strip just above the inventory cutout. When
    // there's more vertical room than needed, the rest stays transparent
    // so the right panel below dominates the right side.
    const STRIP_MAX = 64;
    const stripH = importing ? Math.min(topGapH, STRIP_MAX) : 0;
    const aboveStripH = Math.max(0, topGapH - stripH);

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
                    // LEFT COLUMN — unchanged, full content height.
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
                    // CENTER COLUMN — above-menu strip + inventory cutout +
                    // bottom toolbar. The compact LiveImporter strip sits
                    // directly above the inventory; everything above the
                    // strip is transparent so the screen isn't covered.
                    Col({
                        style: {
                            width: { kind: "px", value: centerColW },
                            height: { kind: "grow" },
                        },
                        children: [
                            transparentPad(aboveStripH),
                            stripH > 0 ? bgWrap(LiveImporter(), stripH) : false,
                            importing ? stablePanel(b.ySize) : transparentPad(b.ySize),
                            bgWrap(BottomToolbar(), "grow"),
                        ],
                    }),
                    // RIGHT COLUMN — full content height. Hosts the
                    // line-by-line diff view (RightPanel) so it has the
                    // most room available for context during imports.
                    Container({
                        style: {
                            width: { kind: "px", value: rightColW },
                            height: { kind: "grow" },
                            background: COLOR_PANEL_BORDER,
                            padding: 1,
                        },
                        children: [
                            Container({
                                style: {
                                    width: { kind: "grow" },
                                    height: { kind: "grow" },
                                    background: COLOR_PANEL,
                                },
                                children: [RightPanel()],
                            }),
                        ],
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
            const b = getStableBounds();
            if (b === null) return [];
            return [buildLayout(b)];
        },
    });
}
