/// <reference types="../../../CTAutocomplete" />

import { pointInRect, type Rect } from "./layout";
import { getOverlayScreenH, getOverlayScreenW } from "./overlayScale";
import { placeAnchoredRect } from "./anchoredRect";
import { COLOR_PANEL, COLOR_PANEL_BORDER } from "./theme";
import { pushScissor, popScissor } from "./scissor";

const OPEN_DELAY_MS = 150;
const LEAVE_GRACE_MS = 100;
const PAD = 6;
const TEXT_TOP_INSET = 1;
const LINE_H = 9;
const MIN_W = 220;
const MAX_W = 760;
const MAX_W_SCREEN_RATIO = 0.8;
const MAX_H = 240;
const SCROLLBAR_W = 3;
const COLOR_SCROLLBAR = 0xff888888 | 0;

type HoverCardLineSegment = { x: number; text: string };

export type HoverCardContent = {
    lines: string[];
    segments: HoverCardLineSegment[][];
    width: number;
    height: number;
};

type HoverCard = {
    key: string;
    anchor: Rect;
    content: HoverCardContent;
    offeredAt: number;
    lastAnchorHoverAt: number;
    scrollOffset: number;
};

let card: HoverCard | null = null;
let lastRect: Rect | null = null;
let lastMouseOverCardAt = 0;

export function hoverCardContentWidth(): number {
    const maxWidth = Math.min(MAX_W, Math.floor(getOverlayScreenW() * MAX_W_SCREEN_RATIO));
    return Math.max(1, maxWidth - PAD * 2);
}

export function offerHoverCard(options: {
    key: string;
    anchor: Rect;
    content: HoverCardContent;
}): void {
    const now = Date.now();
    if (card === null || card.key !== options.key) {
        card = {
            key: options.key,
            anchor: options.anchor,
            content: options.content,
            offeredAt: now,
            lastAnchorHoverAt: now,
            scrollOffset: 0,
        };
        lastRect = null;
        return;
    }
    card.anchor = options.anchor;
    card.content = options.content;
    card.lastAnchorHoverAt = now;
}

export function closeHoverCard(): void {
    card = null;
    lastRect = null;
    lastMouseOverCardAt = 0;
}

export function isHoverCardVisible(): boolean {
    return card !== null && Date.now() - card.offeredAt >= OPEN_DELAY_MS;
}

export function mouseIsOverHoverCard(mouseX: number, mouseY: number): boolean {
    return isHoverCardVisible() && lastRect !== null && pointInRect(lastRect, mouseX, mouseY);
}

function cardRect(content: HoverCardContent): Rect {
    const screenW = getOverlayScreenW();
    const screenH = getOverlayScreenH();
    const maxWidth = Math.min(MAX_W, Math.floor(screenW * MAX_W_SCREEN_RATIO));
    const minWidth = Math.min(MIN_W, maxWidth);
    const width = Math.max(minWidth, Math.min(maxWidth, content.width + PAD * 2 + SCROLLBAR_W));
    const maxHeight = Math.min(MAX_H, Math.floor(screenH * 0.65));
    const height = Math.min(
        maxHeight,
        Math.max(LINE_H + PAD * 2 + TEXT_TOP_INSET, content.height * LINE_H + PAD * 2 + TEXT_TOP_INSET)
    );
    return placeAnchoredRect(card!.anchor, width, height, screenW, screenH, "left");
}

function maxScroll(rect: Rect, content: HoverCardContent): number {
    return Math.max(0, content.height * LINE_H - (rect.h - PAD * 2 - TEXT_TOP_INSET));
}

function shouldKeep(now: number, mouseX: number, mouseY: number): boolean {
    if (card === null) return false;
    if (lastRect !== null && pointInRect(lastRect, mouseX, mouseY)) {
        lastMouseOverCardAt = now;
        return true;
    }
    return now - Math.max(card.lastAnchorHoverAt, lastMouseOverCardAt) <= LEAVE_GRACE_MS;
}

export function drawHoverCard(mouseX: number, mouseY: number): void {
    if (card === null) return;
    const now = Date.now();
    if (!shouldKeep(now, mouseX, mouseY)) {
        closeHoverCard();
        return;
    }
    if (now - card.offeredAt < OPEN_DELAY_MS) return;

    const rect = cardRect(card.content);
    lastRect = rect;
    card.scrollOffset = Math.min(card.scrollOffset, maxScroll(rect, card.content));
    Renderer.drawRect(COLOR_PANEL_BORDER, rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
    Renderer.drawRect(COLOR_PANEL, rect.x, rect.y, rect.w, rect.h);
    const viewport = {
        x: rect.x + PAD,
        y: rect.y + PAD + TEXT_TOP_INSET,
        w: rect.w - PAD * 2,
        h: rect.h - PAD * 2 - TEXT_TOP_INSET,
    };
    pushScissor(viewport);
    for (let i = 0; i < card.content.segments.length; i++) {
        const y = viewport.y + i * LINE_H - card.scrollOffset;
        if (y + LINE_H < viewport.y || y > viewport.y + viewport.h) continue;
        const segs = card.content.segments[i];
        for (let s = 0; s < segs.length; s++) {
            Renderer.drawString(segs[s].text, viewport.x + segs[s].x, y);
        }
    }
    popScissor();
    const scrollMax = maxScroll(rect, card.content);
    if (scrollMax > 0) {
        const thumbH = Math.max(8, Math.floor((viewport.h * viewport.h) / (card.content.height * LINE_H)));
        const thumbY = viewport.y + Math.floor((viewport.h - thumbH) * (card.scrollOffset / scrollMax));
        Renderer.drawRect(COLOR_SCROLLBAR, rect.x + rect.w - SCROLLBAR_W, thumbY, SCROLLBAR_W, thumbH);
    }
}

export function tryDispatchHoverCardWheel(
    mouseX: number,
    mouseY: number,
    delta: number
): boolean {
    if (card === null || !mouseIsOverHoverCard(mouseX, mouseY) || lastRect === null) return false;
    const limit = maxScroll(lastRect, card.content);
    card.scrollOffset = Math.max(0, Math.min(limit, card.scrollOffset - delta * LINE_H * 3));
    return true;
}

export function tryDispatchHoverCardClick(mouseX: number, mouseY: number): boolean {
    return mouseIsOverHoverCard(mouseX, mouseY);
}
