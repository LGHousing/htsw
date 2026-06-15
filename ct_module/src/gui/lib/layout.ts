/// <reference types="../../../CTAutocomplete" />

import { Extractable, extract } from "./extractable";

type PaddingSide = "all" | "x" | "y" | "top" | "right" | "bottom" | "left";

type PaddingEntry = { side: PaddingSide; value: number };
type Padding = number | PaddingEntry | PaddingEntry[];

type Size =
    | { kind: "px"; value: number }
    | { kind: "auto" }
    | { kind: "grow"; factor?: number };

export type Style = {
    width?: Size;
    height?: Size;
    padding?: Padding;
    background?: Extractable<number | undefined>;
    hoverBackground?: Extractable<number | undefined>;
};

export type ContainerStyle = Style & {
    direction?: "row" | "col";
    gap?: number;
    // Cross-axis alignment of children (perpendicular to direction).
    align?: "start" | "center" | "end" | "stretch";
    // Main-axis alignment of children as a group (parallel to direction).
    // Only meaningful when no child has `kind: "grow"` on the main axis —
    // grows already eat all the leftover space.
    justify?: "start" | "center" | "end";
};

export type Child = Element | false;

// Mouse button ids match LWJGL: 0 = left, 1 = right, 2 = middle.
// x/y are the mouse coordinates of the click in MC scaled space.
export type ClickInfo = {
    button: number;
    x: number;
    y: number;
    isDoubleClickSecond: boolean;
};

export type Element =
    | {
          kind: "container";
          style: ContainerStyle;
          children: Extractable<Child[]>;
          onClick?: (rect: Rect, info: ClickInfo) => void;
          onDoubleClick?: (rect: Rect) => void;
          onHover?: (rect: Rect, mouseX: number, mouseY: number) => void;
          /** Reports this container's laid-out rect into lib/anchors each
           * rendered frame, under this key. */
          anchorKey?: string;
      }
    | {
          kind: "text";
          style: Style;
          text: Extractable<string>;
          color?: Extractable<number | undefined>;
          underlineColor?: Extractable<number | undefined>;
          // When set, hovering this text element shows a small tooltip chip
          // anchored just below (or above near the screen edge) the rect.
          tooltip?: Extractable<string>;
          tooltipColor?: Extractable<number>;
          // When true, the string is shortened with a trailing ellipsis to fit
          // the laid-out rect width instead of overflowing into neighbours.
          // Opt-in: bare text is allowed to overflow (some rows rely on a later
          // sibling painting over the spill).
          truncate?: boolean;
      }
    | {
          kind: "input";
          style: Style;
          id: string;
          value: Extractable<string>;
          onChange: (v: string) => void;
          /**
           * Called when Enter is pressed while this input is focused. The
           * keyboard handler routes Enter to onSubmit (clearing focus
           * itself); inputs without an onSubmit just unfocus on Enter.
           */
          onSubmit?: () => void;
          placeholder?: string;
      }
    | {
          kind: "scroll";
          style: ContainerStyle;
          id: string;
          children: Extractable<Child[]>;
          /** Scroll axis. Defaults to "y" (vertical). */
          axis?: "x" | "y";
          /** When true, scroll input is consumed without moving the viewport. */
          locked?: Extractable<boolean>;
      }
    | {
          kind: "image";
          style: Style;
          // Icon name without the .png suffix, e.g. "a-arrow-down".
          // The Vite icon plugin scans the bundled output for these literals
          // and copies only the matched PNGs into dist/assets/icons/.
          name: Extractable<string>;
          // Optional ARGB tint multiplied over the (white) PNG at draw time.
          // The icon set is monochrome white, so this recolors it.
          color?: Extractable<number>;
          // Hover chip, same semantics as the text element's tooltip.
          tooltip?: Extractable<string>;
          tooltipColor?: Extractable<number>;
      }
    | {
          kind: "mcItem";
          style: Style;
          item: string;
          count: number;
      };

function extractChildren(c: Extractable<Child[]>): Element[] {
    const raw = extract(c);
    const out: Element[] = [];
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch !== false) out.push(ch);
    }
    return out;
}

export type Rect = { x: number; y: number; w: number; h: number };
export type LaidOut = { element: Element; rect: Rect; clipRect?: Rect };

type ResolvedPadding = { t: number; r: number; b: number; l: number };

const LINE_H = 8;
const INPUT_PAD_Y = 6;
const TEXT_PAD = 0;
const SCROLLBAR_W = 4;

function resolvePadding(p: Padding | undefined): ResolvedPadding {
    const out: ResolvedPadding = { t: 0, r: 0, b: 0, l: 0 };
    if (p === undefined) return out;
    if (typeof p === "number") {
        out.t = out.r = out.b = out.l = p;
        return out;
    }
    const entries: PaddingEntry[] = isPaddingEntry(p) ? [p] : p;
    for (let i = 0; i < entries.length; i++) {
        const v = entries[i].value;
        switch (entries[i].side) {
            case "all":
                out.t = out.r = out.b = out.l = v;
                break;
            case "x":
                out.l = out.r = v;
                break;
            case "y":
                out.t = out.b = v;
                break;
            case "top":
                out.t = v;
                break;
            case "right":
                out.r = v;
                break;
            case "bottom":
                out.b = v;
                break;
            case "left":
                out.l = v;
                break;
        }
    }
    return out;
}

function isPaddingEntry(p: PaddingEntry | PaddingEntry[]): p is PaddingEntry {
    return !(p instanceof Array);
}

function textContent(text: string): { w: number; h: number } {
    const w = Client.getMinecraft().field_71466_p.func_78256_a(text);
    return { w: w + TEXT_PAD * 2, h: LINE_H + TEXT_PAD * 2 };
}

function inputContent(_: string): { w: number; h: number } {
    return { w: 80, h: LINE_H + INPUT_PAD_Y * 2 };
}

const ICON_DEFAULT_SIZE = 16;
function imageContent(): { w: number; h: number } {
    return { w: ICON_DEFAULT_SIZE, h: ICON_DEFAULT_SIZE };
}

function containerContent(c: { style: ContainerStyle; children: Extractable<Child[]> }): {
    w: number;
    h: number;
} {
    const pad = resolvePadding(c.style.padding);
    const dir = c.style.direction ?? "col";
    const gap = c.style.gap ?? 0;
    const children = extractChildren(c.children);
    let mainSum = 0;
    let crossMax = 0;
    for (let i = 0; i < children.length; i++) {
        const m = measure(children[i]);
        if (dir === "row") {
            mainSum += m.w;
            if (m.h > crossMax) crossMax = m.h;
        } else {
            mainSum += m.h;
            if (m.w > crossMax) crossMax = m.w;
        }
    }
    if (children.length > 1) mainSum += gap * (children.length - 1);
    return dir === "row"
        ? { w: mainSum + pad.l + pad.r, h: crossMax + pad.t + pad.b }
        : { w: crossMax + pad.l + pad.r, h: mainSum + pad.t + pad.b };
}

function measure(e: Element): { w: number; h: number } {
    let content: { w: number; h: number };
    if (e.kind === "text") content = textContent(extract(e.text));
    else if (e.kind === "input") content = inputContent(extract(e.value));
    else if (e.kind === "scroll") content = { w: 0, h: 0 };
    else if (e.kind === "image") content = imageContent();
    else if (e.kind === "mcItem") content = { w: 16, h: 16 };
    else content = containerContent(e);
    const w = e.style.width;
    const h = e.style.height;
    return {
        w: w && w.kind === "px" ? w.value : content.w,
        h: h && h.kind === "px" ? h.value : content.h,
    };
}

function resolveAxis(e: Element, axis: "w" | "h"): number | null {
    const s = axis === "w" ? e.style.width : e.style.height;
    if (!s || s.kind === "auto") {
        const m = measure(e);
        return axis === "w" ? m.w : m.h;
    }
    if (s.kind === "px") return s.value;
    return null;
}

function growFactorOf(e: Element, axis: "w" | "h"): number {
    const s = axis === "w" ? e.style.width : e.style.height;
    if (s && s.kind === "grow") return s.factor ?? 1;
    return 0;
}

// Cross-axis size + position for one child, shared by container and scroll
// layout: stretch fills the cross length unless the child fixed its own cross
// size; center/end offset the child within the leftover.
function placeCross(
    ch: Element,
    crossAxis: "w" | "h",
    crossLen: number,
    crossOrigin: number,
    align: "start" | "center" | "end" | "stretch"
): { size: number; offset: number } {
    const explicit = crossAxis === "w" ? ch.style.width : ch.style.height;
    const resolved = resolveAxis(ch, crossAxis);
    let size: number;
    if (resolved === null) size = crossLen;
    else if (align === "stretch" && (!explicit || explicit.kind === "auto"))
        size = crossLen;
    else size = Math.min(resolved, crossLen);

    let offset = crossOrigin;
    if (align === "center") offset = crossOrigin + Math.floor((crossLen - size) / 2);
    else if (align === "end") offset = crossOrigin + (crossLen - size);
    return { size, offset };
}

// Per-id scroll state. Reset across reloads but persists across frames.
type ScrollState = {
    offset: number;
    /** Content size along the scroll axis (height for "y", width for "x"). */
    contentLength: number;
    axis: "x" | "y";
    viewportRect: Rect;
    /**
     * True when the user has manually scrolled (wheel or drag). While
     * set, autoscroll-following code (e.g. CodeView's applyAutoFollow)
     * suppresses its scroll updates. Cleared by `clearUserScrollOverride`
     * — typically when the user clicks a "jump to current" pip.
     */
    userOverridden: boolean;
};
const scrollStates: { [id: string]: ScrollState } = {};

export function getScrollState(id: string): ScrollState {
    let s = scrollStates[id];
    if (!s) {
        s = {
            offset: 0,
            contentLength: 0,
            axis: "y",
            viewportRect: { x: 0, y: 0, w: 0, h: 0 },
            userOverridden: false,
        };
        scrollStates[id] = s;
    }
    return s;
}

export function setScrollOffset(id: string, offset: number): void {
    const s = getScrollState(id);
    const view = s.axis === "x" ? s.viewportRect.w : s.viewportRect.h;
    s.offset = Math.max(0, Math.min(Math.max(0, s.contentLength - view), offset));
}

export function markUserScroll(id: string): void {
    getScrollState(id).userOverridden = true;
}

export function clearUserScrollOverride(id: string): void {
    getScrollState(id).userOverridden = false;
}

export function isScrollUserOverridden(id: string): boolean {
    return getScrollState(id).userOverridden;
}

export const SCROLLBAR_WIDTH = SCROLLBAR_W;

export function layoutElement(
    root: Element,
    x: number,
    y: number,
    w: number,
    h: number
): LaidOut[] {
    const out: LaidOut[] = [];
    out.push({ element: root, rect: { x, y, w, h } });
    if (root.kind === "container") layoutContainer(root, x, y, w, h, out, undefined);
    else if (root.kind === "scroll") layoutScroll(root, x, y, w, h, out, undefined);
    return out;
}

function layoutContainer(
    c: { kind: "container"; style: ContainerStyle; children: Extractable<Child[]> },
    x: number,
    y: number,
    w: number,
    h: number,
    out: LaidOut[],
    clipRect: Rect | undefined
): void {
    const pad = resolvePadding(c.style.padding);
    const innerX = x + pad.l,
        innerY = y + pad.t;
    const innerW = Math.max(0, w - pad.l - pad.r);
    const innerH = Math.max(0, h - pad.t - pad.b);
    const dir = c.style.direction ?? "col";
    const gap = c.style.gap ?? 0;
    const align = c.style.align ?? "stretch";
    const isRow = dir === "row";
    const mainLen = isRow ? innerW : innerH;
    const crossLen = isRow ? innerH : innerW;
    const mainAxis: "w" | "h" = isRow ? "w" : "h";
    const crossAxis: "w" | "h" = isRow ? "h" : "w";

    const children = extractChildren(c.children);
    const n = children.length;
    if (n === 0) return;

    const mainSizes: (number | null)[] = [];
    let fixedSum = 0;
    for (let i = 0; i < n; i++) {
        const m = resolveAxis(children[i], mainAxis);
        mainSizes.push(m);
        if (m !== null) fixedSum += m;
    }
    const gapSum = n > 1 ? gap * (n - 1) : 0;
    const leftover = Math.max(0, mainLen - fixedSum - gapSum);

    let growTotal = 0;
    for (let i = 0; i < n; i++) {
        if (mainSizes[i] === null) growTotal += growFactorOf(children[i], mainAxis);
    }
    if (growTotal > 0) {
        let assigned = 0,
            lastGrowIdx = -1;
        for (let i = 0; i < n; i++) {
            if (mainSizes[i] === null) {
                const f = growFactorOf(children[i], mainAxis);
                const portion = Math.floor((leftover * f) / growTotal);
                mainSizes[i] = portion;
                assigned += portion;
                lastGrowIdx = i;
            }
        }
        if (lastGrowIdx >= 0) {
            mainSizes[lastGrowIdx] =
                (mainSizes[lastGrowIdx] as number) + (leftover - assigned);
        }
    } else {
        for (let i = 0; i < n; i++) if (mainSizes[i] === null) mainSizes[i] = 0;
    }

    // Main-axis justify: when there are no grow children, leftover lives at the
    // ends. Shift the start cursor so the children sit centered/end as a group.
    const justify = c.style.justify ?? "start";
    let cursor = isRow ? innerX : innerY;
    if (growTotal === 0 && justify !== "start" && leftover > 0) {
        if (justify === "center") cursor += Math.floor(leftover / 2);
        else if (justify === "end") cursor += leftover;
    }
    for (let i = 0; i < n; i++) {
        const ch = children[i];
        const mSize = mainSizes[i] as number;

        const crossOriginIn = isRow ? innerY : innerX;
        const cross = placeCross(ch, crossAxis, crossLen, crossOriginIn, align);

        const rect: Rect = isRow
            ? { x: cursor, y: cross.offset, w: mSize, h: cross.size }
            : { x: cross.offset, y: cursor, w: cross.size, h: mSize };

        out.push({ element: ch, rect, clipRect });
        if (ch.kind === "container")
            layoutContainer(ch, rect.x, rect.y, rect.w, rect.h, out, clipRect);
        else if (ch.kind === "scroll")
            layoutScroll(ch, rect.x, rect.y, rect.w, rect.h, out, clipRect);

        cursor += mSize + gap;
    }
}

function layoutScroll(
    s: {
        kind: "scroll";
        style: ContainerStyle;
        id: string;
        children: Extractable<Child[]>;
        axis?: "x" | "y";
    },
    x: number,
    y: number,
    w: number,
    h: number,
    out: LaidOut[],
    _parentClip: Rect | undefined
): void {
    const pad = resolvePadding(s.style.padding);
    const innerX = x + pad.l;
    const innerY = y + pad.t;
    const innerW = Math.max(0, w - pad.l - pad.r);
    const innerH = Math.max(0, h - pad.t - pad.b);
    const gap = s.style.gap ?? 0;
    const align = s.style.align ?? "stretch";
    const horizontal = s.axis === "x";

    const state = getScrollState(s.id);
    state.axis = horizontal ? "x" : "y";
    state.viewportRect = { x: innerX, y: innerY, w: innerW, h: innerH };
    const viewportRect = state.viewportRect;

    const mainAxis: "w" | "h" = horizontal ? "w" : "h";
    const crossAxis: "w" | "h" = horizontal ? "h" : "w";
    const mainLen = horizontal ? innerW : innerH;

    const children = extractChildren(s.children);
    const n = children.length;

    // Total content size along the scroll axis, resolved before placement so
    // the scrollbar math is independent of the viewport cull below.
    let contentMain = 0;
    const sizes: number[] = [];
    for (let i = 0; i < n; i++) {
        const m = resolveAxis(children[i], mainAxis);
        const v = m === null ? 0 : m;
        sizes.push(v);
        contentMain += v;
    }
    if (n > 1) contentMain += gap * (n - 1);
    state.contentLength = contentMain;

    const maxOffset = Math.max(0, contentMain - mainLen);
    if (state.offset > maxOffset) state.offset = maxOffset;
    if (state.offset < 0) state.offset = 0;

    // The vertical scrollbar is drawn inside the viewport, so reserve its track
    // width instead of letting right-aligned labels sit underneath it. The
    // horizontal indicator is a thin overlay along the bottom edge and steals
    // no cross-axis space, so a tab strip keeps its full height.
    //
    // Viewport-cull off-screen children so a long list pays no layout/render
    // cost for what isn't visible. The cull is a fast-skip; `cursor` still
    // advances so later children land where they would without culling. The
    // buffer lets a few just-off-screen children lay out so a tiny scroll
    // delta doesn't reveal an un-laid-out gap before the next frame.
    const crossLen = horizontal ? innerH : Math.max(0, innerW - SCROLLBAR_W);
    const CULL_BUFFER = 32;
    const viewLow = horizontal ? viewportRect.x : viewportRect.y;
    const viewHigh = horizontal
        ? viewportRect.x + viewportRect.w
        : viewportRect.y + viewportRect.h;
    const cullLow = viewLow - CULL_BUFFER;
    const cullHigh = viewHigh + CULL_BUFFER;
    const crossOrigin = horizontal ? innerY : innerX;
    let cursor = (horizontal ? innerX : innerY) - Math.round(state.offset);
    for (let i = 0; i < n; i++) {
        const ch = children[i];
        const mSize = sizes[i];

        const low = cursor;
        const high = cursor + mSize;
        if (high < cullLow || low > cullHigh) {
            cursor += mSize + gap;
            continue;
        }

        const cross = placeCross(ch, crossAxis, crossLen, crossOrigin, align);

        const rect: Rect = horizontal
            ? { x: cursor, y: cross.offset, w: mSize, h: cross.size }
            : { x: cross.offset, y: cursor, w: cross.size, h: mSize };
        out.push({ element: ch, rect, clipRect: viewportRect });
        if (ch.kind === "container")
            layoutContainer(ch, rect.x, rect.y, rect.w, rect.h, out, viewportRect);
        else if (ch.kind === "scroll")
            layoutScroll(ch, rect.x, rect.y, rect.w, rect.h, out, viewportRect);
        cursor += mSize + gap;
    }
}

export function pointInRect(r: Rect, x: number, y: number): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function intersectRect(a: Rect, b: Rect): Rect {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}
