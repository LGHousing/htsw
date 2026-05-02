/// <reference types="../../CTAutocomplete" />

import {
    Element, LaidOut, layoutElement, pointInRect,
    getScrollState, SCROLLBAR_WIDTH,
} from "./layout";
import { extract } from "./extractable";
import { isInputFocused, setFocusedInput } from "./focus";
import { pushScissor, popScissor } from "./scissor";
import { getInputField } from "./inputState";

let dbgLog: ((m: string) => void) = () => {};
export function setRenderDebugLog(fn: (m: string) => void): void { dbgLog = fn; }

const COLOR_BUTTON = 0xe02d333d | 0;
const COLOR_BUTTON_HOVER = 0xf03a4350 | 0;
const COLOR_INPUT_BG = 0xff000000 | 0;
const COLOR_INPUT_BORDER = 0xff444444 | 0;
const COLOR_INPUT_BORDER_HOVER = 0xffa2a2a2 | 0;
const COLOR_INPUT_BORDER_FOCUS = 0xff67a7e8 | 0;
const COLOR_SCROLLBAR_TRACK = 0x40000000 | 0;
const COLOR_SCROLLBAR_THUMB = 0xff888888 | 0;
const COLOR_SCROLLBAR_THUMB_HOVER = 0xffaaaaaa | 0;

const LINE_H = 8;


export function renderElement(root: Element, x: number, y: number, w: number, h: number, mouseX: number, mouseY: number, interactive: boolean): LaidOut[] {
    const laid = layoutElement(root, x, y, w, h);

    // A click here would be intercepted by the scrollbar thumb (it starts a drag) — suppress hover
    // on items underneath so visual feedback matches click propagation. Anywhere the click would
    // actually reach the element, hover lights up normally.
    const intercepted = getClickInterceptor(laid, mouseX, mouseY) !== null;

    for (let i = 0; i < laid.length; i++) {
        const item = laid[i];
        if (item.element === root) continue; // root drawn by caller (panel bg) or skipped
        renderItem(item, mouseX, mouseY, interactive, intercepted);
    }

    // Scrollbars render last (on top of clipped content) — overlay style.
    for (let i = 0; i < laid.length; i++) {
        const item = laid[i];
        if (item.element.kind !== "scroll") continue;
        renderScrollbar(item.element.id, mouseX, mouseY);
    }

    return laid;
}

// Returns the rect at (mx,my) that would intercept a click before it reaches normal element
// dispatch — currently only the scrollbar THUMB does this. Hover suppression and click dispatch
// share this predicate so the two are always consistent: anywhere a click would still reach the
// underlying element (e.g. the empty part of a scrollbar track), hover also lights up.
function getClickInterceptor(laid: LaidOut[], mx: number, my: number): { x: number; y: number; w: number; h: number } | null {
    for (let i = 0; i < laid.length; i++) {
        const item = laid[i];
        if (item.element.kind !== "scroll") continue;
        const s = getScrollState(item.element.id);
        if (s.contentHeight <= s.viewportRect.h) continue;
        const v = s.viewportRect;
        const trackX = v.x + v.w - SCROLLBAR_WIDTH;
        const thumbH = Math.max(8, Math.floor(v.h * v.h / s.contentHeight));
        const maxOffset = s.contentHeight - v.h;
        const thumbY = v.y + Math.floor((v.h - thumbH) * (s.offset / maxOffset));
        const thumbRect = { x: trackX, y: thumbY, w: SCROLLBAR_WIDTH, h: thumbH };
        if (pointInRect(thumbRect, mx, my)) return thumbRect;
    }
    return null;
}

function renderItem(item: LaidOut, mouseX: number, mouseY: number, interactive: boolean, intercepted: boolean): void {
    const r = item.rect;
    const e = item.element;
    const inClip = !item.clipRect || pointInRect(item.clipRect, mouseX, mouseY);
    const hovered = interactive && inClip && !intercepted && pointInRect(r, mouseX, mouseY);

    if (item.clipRect) pushScissor(item.clipRect);

    if (e.kind === "container") {
        const hoverBg = e.style.hoverBackground !== undefined ? extract(e.style.hoverBackground) : undefined;
        const baseBg = e.style.background !== undefined ? extract(e.style.background) : undefined;
        const bg = (hovered && e.onClick && hoverBg !== undefined) ? hoverBg : baseBg;
        if (bg !== undefined) Renderer.drawRect(bg, r.x, r.y, r.w, r.h);
    } else if (e.kind === "button") {
        const baseBg = e.style.background !== undefined ? extract(e.style.background) : undefined;
        const hoverBg = e.style.hoverBackground !== undefined ? extract(e.style.hoverBackground) : undefined;
        const bg = baseBg !== undefined ? baseBg : COLOR_BUTTON;
        const hBg = hoverBg !== undefined ? hoverBg : COLOR_BUTTON_HOVER;
        Renderer.drawRect(hovered ? hBg : bg, r.x, r.y, r.w, r.h);
        const text = extract(e.text);
        const tw = Renderer.getStringWidth(text);
        const tx = r.x + Math.max(2, Math.floor((r.w - tw) / 2));
        const ty = r.y + Math.max(2, Math.floor((r.h - LINE_H) / 2));
        Renderer.drawString(text, tx, ty);
    } else if (e.kind === "text") {
        const text = extract(e.text);
        const ty = r.y + Math.max(0, Math.floor((r.h - LINE_H) / 2));
        Renderer.drawString(text, r.x, ty);
    } else if (e.kind === "input") {
        const focused = isInputFocused(e.id);
        const value = extract(e.value);
        // Background + border drawn by us (GuiTextField's own background is disabled).
        Renderer.drawRect(COLOR_INPUT_BG, r.x, r.y, r.w, r.h);
        const borderCol = focused
            ? COLOR_INPUT_BORDER_FOCUS
            : (hovered ? COLOR_INPUT_BORDER_HOVER : COLOR_INPUT_BORDER);
        Renderer.drawRect(borderCol, r.x, r.y, r.w, 1);
        Renderer.drawRect(borderCol, r.x, r.y + r.h - 1, r.w, 1);
        Renderer.drawRect(borderCol, r.x, r.y, 1, r.h);
        Renderer.drawRect(borderCol, r.x + r.w - 1, r.y, 1, r.h);
        if (value.length === 0 && e.placeholder && !focused) {
            const ty = r.y + Math.max(2, Math.floor((r.h - LINE_H) / 2));
            Renderer.drawStringWithShadow(`§r§8${e.placeholder}`, r.x + 4, ty);
        } else {
            // Inset the field so cursor/text don't paint over our 1px border.
            const innerY = r.y + Math.max(2, Math.floor((r.h - LINE_H) / 2));
            const field = getInputField(e.id, r.x + 4, innerY, r.w - 8, LINE_H, value);
            field.func_146194_f(); // drawTextBox
        }
    } else if (e.kind === "scroll") {
        const bg = e.style.background !== undefined ? extract(e.style.background) : undefined;
        if (bg !== undefined) Renderer.drawRect(bg, r.x, r.y, r.w, r.h);
    }

    if (item.clipRect) popScissor();
}

function renderScrollbar(id: string, mouseX: number, mouseY: number): void {
    const s = getScrollState(id);
    if (s.contentHeight <= s.viewportRect.h) return; // not overflowing
    const v = s.viewportRect;
    const trackX = v.x + v.w - SCROLLBAR_WIDTH;
    Renderer.drawRect(COLOR_SCROLLBAR_TRACK, trackX, v.y, SCROLLBAR_WIDTH, v.h);
    const thumbH = Math.max(8, Math.floor(v.h * v.h / s.contentHeight));
    const maxOffset = s.contentHeight - v.h;
    const thumbY = v.y + Math.floor((v.h - thumbH) * (s.offset / maxOffset));
    const thumbRect = { x: trackX, y: thumbY, w: SCROLLBAR_WIDTH, h: thumbH };
    const hovered = pointInRect(thumbRect, mouseX, mouseY);
    Renderer.drawRect(hovered ? COLOR_SCROLLBAR_THUMB_HOVER : COLOR_SCROLLBAR_THUMB, thumbRect.x, thumbRect.y, thumbRect.w, thumbRect.h);
}

export type ClickResult = "consumed" | "passthrough" | "miss";

// Returns "consumed" if a clickable was hit, "miss" otherwise.
// Also handles input focusing and scrollbar drag start.
export function dispatchClick(laid: LaidOut[], mouseX: number, mouseY: number): boolean {
    dbgLog(`dispatchClick @(${mouseX},${mouseY}) laid.length=${laid.length}`);
    // Scrollbar thumb drag start uses the same interceptor predicate as hover suppression so the
    // two stay consistent. We still need the scroll id to start the drag, so look it up here.
    if (getClickInterceptor(laid, mouseX, mouseY) !== null) {
        for (let i = 0; i < laid.length; i++) {
            const item = laid[i];
            if (item.element.kind !== "scroll") continue;
            const s = getScrollState(item.element.id);
            if (s.contentHeight <= s.viewportRect.h) continue;
            const v = s.viewportRect;
            const trackX = v.x + v.w - SCROLLBAR_WIDTH;
            const thumbH = Math.max(8, Math.floor(v.h * v.h / s.contentHeight));
            const maxOffset = s.contentHeight - v.h;
            const thumbY = v.y + Math.floor((v.h - thumbH) * (s.offset / maxOffset));
            if (pointInRect({ x: trackX, y: thumbY, w: SCROLLBAR_WIDTH, h: thumbH }, mouseX, mouseY)) {
                startScrollbarDrag(item.element.id, mouseY);
                return true;
            }
        }
    }

    // Topmost-first: walk in reverse.
    for (let i = laid.length - 1; i >= 0; i--) {
        const item = laid[i];
        if (item.clipRect && !pointInRect(item.clipRect, mouseX, mouseY)) continue;
        if (!pointInRect(item.rect, mouseX, mouseY)) continue;
        const e = item.element;
        dbgLog(`  hit kind=${e.kind} rect=(${item.rect.x},${item.rect.y} ${item.rect.w}x${item.rect.h})`);
        if (e.kind === "button") {
            setFocusedInput(null);
            e.onClick(item.rect);
            return true;
        }
        if (e.kind === "container" && e.onClick) {
            setFocusedInput(null);
            e.onClick(item.rect);
            return true;
        }
        if (e.kind === "input") {
            dbgLog(`  -> focusing input id=${e.id}`);
            setFocusedInput(e.id);
            // Forward click to the GuiTextField for cursor placement / drag-select start.
            // The field must already be marked focused for mouseClicked to set the cursor.
            const rec = getInputField(e.id, item.rect.x + 4, item.rect.y, item.rect.w - 8, item.rect.h, extract(e.value));
            rec.func_146195_b(true); // setFocused
            rec.func_146192_a(mouseX, mouseY, 0); // mouseClicked
            return true;
        }
    }
    dbgLog(`  no hit`);
    // Click landed on the panel but didn't hit anything clickable — still drop focus,
    // matching the behavior of clicking outside the panel entirely.
    setFocusedInput(null);
    return false;
}

// --- Scrollbar drag state ---
let dragScrollId: string | null = null;
let dragStartMouseY = 0;
let dragStartOffset = 0;

function startScrollbarDrag(id: string, mouseY: number): void {
    dragScrollId = id;
    dragStartMouseY = mouseY;
    dragStartOffset = getScrollState(id).offset;
}

export function isDraggingScrollbar(): boolean { return dragScrollId !== null; }

export function updateScrollbarDrag(mouseY: number): void {
    if (dragScrollId === null) return;
    const s = getScrollState(dragScrollId);
    if (s.contentHeight <= s.viewportRect.h) { dragScrollId = null; return; }
    const v = s.viewportRect;
    const thumbH = Math.max(8, Math.floor(v.h * v.h / s.contentHeight));
    const trackPx = v.h - thumbH;
    if (trackPx <= 0) return;
    const dy = mouseY - dragStartMouseY;
    const maxOffset = s.contentHeight - v.h;
    s.offset = Math.max(0, Math.min(maxOffset, dragStartOffset + Math.floor(dy * (maxOffset / trackPx))));
}

export function endScrollbarDrag(): void { dragScrollId = null; }

// --- Wheel scroll dispatch: find topmost scroll under cursor, scroll it ---
export function dispatchWheel(laid: LaidOut[], mouseX: number, mouseY: number, delta: number): boolean {
    for (let i = laid.length - 1; i >= 0; i--) {
        const item = laid[i];
        if (item.element.kind !== "scroll") continue;
        const s = getScrollState(item.element.id);
        if (!pointInRect(s.viewportRect, mouseX, mouseY)) continue;
        if (s.contentHeight <= s.viewportRect.h) return true;
        s.offset = Math.max(0, Math.min(s.contentHeight - s.viewportRect.h, s.offset - delta * 20));
        return true;
    }
    return false;
}
