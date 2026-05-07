/// <reference types="../../CTAutocomplete" />

import { Element } from "./lib/layout";
import { Col, Container, Row } from "./lib/components";
import {
    SCREEN_PAD,
    getChatBounds,
    getContainerBounds,
    type ContainerBounds,
} from "./lib/bounds";
import { LeftPanel } from "./left-panel";
import { RightPanel } from "./right-panel";
import { BottomToolbar } from "./bottom-toolbar";
import { ChatInputBar } from "./chat-input";
import { getImportProgress } from "./state";
import { COLOR_PANEL } from "./lib/theme";

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
    const chat = getChatBounds(b);
    const contentRowY = SCREEN_PAD;
    const leftColW = Math.max(0, b.left - SCREEN_PAD);
    const centerColW = b.xSize;
    // Right column eats everything from the inventory's right edge to the
    // screen edge minus SCREEN_PAD on both sides — same gutter the left
    // panel gets against the inventory.
    const rightColW = Math.max(0, b.screenW - SCREEN_PAD - (b.left + b.xSize));

    const topGapH = Math.max(0, b.top - contentRowY);
    const contentRowH = Math.max(0, b.screenH - SCREEN_PAD - contentRowY);
    const leftColBottom = contentRowY + contentRowH;
    const chatTopInLeftCol = Math.max(0, chat.y - contentRowY);
    const chatSpacerH = Math.max(0, Math.min(leftColBottom - chat.y, chat.h));
    const chatInputH = chatTopInLeftCol >= CHAT_INPUT_H + 20 ? CHAT_INPUT_H : 0;
    const railH = Math.max(0, chatTopInLeftCol - chatInputH);

    return Col({
        style: { width: { kind: "grow" }, height: { kind: "grow" } },
        children: [
            // CONTENT ROW — left + center cutouts + right, full screen height
            // (minus SCREEN_PAD top/bottom). No top bar above this row.
            Row({
                style: { width: { kind: "grow" }, height: { kind: "grow" } },
                children: [
                    // LEFT COLUMN — full content height, chat input + cutout
                    // pinned to the bottom of the rail.
                    Col({
                        style: {
                            width: { kind: "px", value: leftColW },
                            height: { kind: "grow" },
                        },
                        children: [
                            bgWrap(LeftPanel(), railH),
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
                            transparentPad(chatSpacerH),
                        ],
                    }),
                    // CENTER COLUMN — transparent above the inventory, the
                    // inventory cutout itself, and the slim BottomToolbar
                    // below. The toolbar paints no background of its own.
                    Col({
                        style: {
                            width: { kind: "px", value: centerColW },
                            height: { kind: "grow" },
                        },
                        children: [
                            transparentPad(topGapH),
                            transparentPad(b.ySize),
                            BottomToolbar(),
                        ],
                    }),
                    // RIGHT COLUMN — same height as the left column. Add
                    // SCREEN_PAD on the inventory-facing side so it doesn't
                    // jam up against the inventory edge (mirrors the gap on
                    // the screen-edge side).
                    Container({
                        style: {
                            width: { kind: "px", value: rightColW },
                            height: { kind: "grow" },
                            padding: { side: "left", value: SCREEN_PAD },
                        },
                        children: [bgWrap(RightPanel(), "grow")],
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
