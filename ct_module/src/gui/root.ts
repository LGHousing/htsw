/// <reference types="../../CTAutocomplete" />

import { Element } from "./lib/layout";
import { Col, Container, Row } from "./lib/components";
import {
    SCREEN_PAD,
    getChatBounds,
    type ContainerBounds,
} from "./lib/bounds";
import { getContainerBoundsOverlay } from "./lib/overlayScale";
import { LeftPanel } from "./left-panel";
import { RightPanel } from "./right-panel";
import { BottomToolbar } from "./bottom-toolbar";
import { ChatPanel } from "./chat";
import { getImportProgress } from "./right-panel/import-tab/importProgress";
import { COLOR_PANEL } from "./lib/theme";

// Smallest chat panel we'll render (input bar + a couple scrollback rows) and
// the minimum height the left rail keeps above it, so a short window degrades
// gracefully instead of squeezing one out entirely.
const CHAT_MIN_H = 56;
const RAIL_MIN_H = 60;
// Transparent sliver between the rail and the chat, mirroring the overlay's
// screen-edge gutters so the two read as separate panels.
const RAIL_CHAT_GAP = 2;

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
    const live = getContainerBoundsOverlay();
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

/**
 * Cached inventory bounds from the most recent menu open during the
 * in-flight import. Used by `overlay.ts` to keep panels visible (and to
 * draw the inventory dim shade) during the transient gap when Hypixel
 * closes the housing menu to prompt for a chat-entered value. Null when
 * no import is in flight or no menu has been observed yet this run.
 */
export function getImportCachedBounds(): ContainerBounds | null {
    return cachedImportBounds;
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
    // Chat fills from the vanilla chat top straight down to the bottom of the
    // column (no dead transparent gap below it). Clamp so neither the chat nor
    // the rail above it collapses on a short window.
    const chatTopInLeftCol = Math.max(0, chat.y - contentRowY);
    let chatH = contentRowH - chatTopInLeftCol;
    chatH = Math.max(chatH, CHAT_MIN_H);
    chatH = Math.min(chatH, Math.max(0, contentRowH - RAIL_MIN_H - RAIL_CHAT_GAP));
    chatH = Math.max(0, chatH);

    return Col({
        style: { width: { kind: "grow" }, height: { kind: "grow" } },
        children: [
            // CONTENT ROW — left + center cutouts + right.
            Row({
                style: { width: { kind: "grow" }, height: { kind: "grow" } },
                children: [
                    // LEFT COLUMN — rail fills the top, chat panel pinned to
                    // the bottom and reaching the screen-edge gutter.
                    Col({
                        style: {
                            width: { kind: "px", value: leftColW },
                            height: { kind: "grow" },
                        },
                        children: [
                            bgWrap(LeftPanel(leftColW), "grow"),
                            transparentPad(RAIL_CHAT_GAP),
                            ChatPanel(leftColW, chatH),
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
