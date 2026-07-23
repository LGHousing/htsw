/// <reference types="../../../CTAutocomplete" />

import { Extractable, extract } from "./extractable";
import { getMinecraft } from "./java";

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
          /** Suppresses the white click-flash pulse. For clickable surfaces
           * that are content rather than controls (code-view lines), where the
           * flash reads as a glitch instead of feedback. */
          noClickFlash?: boolean;
          disabled?: Extractable<boolean>;
          onHover?: (rect: Rect, mouseX: number, mouseY: number) => void;
          tooltip?: Extractable<string>;
          tooltipColor?: Extractable<number>;
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
          // The icon set is monochrome white, so this recolors it. `undefined`
          // (extracted) leaves it white — the renderer skips the tint.
          color?: Extractable<number | undefined>;
          // Hover chip, same semantics as the text element's tooltip.
          tooltip?: Extractable<string>;
          tooltipColor?: Extractable<number>;
      }
    | {
          kind: "mcItem";
          style: Style;
          item: string;
          count: number;
          metadata: number;
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

// Time constant for easing the rendered scroll offset toward its wheel-set
// target. MC drains mouse-wheel events at tick rate (~20Hz) while panels
// repaint every frame, so applying the target directly makes a continuous
// scroll travel in visible ~50ms steps. ~20ms smooths a trackpad's event
// bursts into per-frame motion while settling a single notch in ~2-3 frames.
// Lower = snappier/closer to raw, higher = floatier.
const SCROLL_SMOOTH_TAU_MS = 20;

// Whether wheel easing is on. The lib is project-agnostic, so the GUI injects
// the user's "Smooth scrolling" setting here; default true until it does.
// When false, `advanceScrollOffset` snaps to target (instant, original feel).
let scrollEasingEnabled: () => boolean = () => true;
export function setScrollEasingProvider(fn: () => boolean): void {
    scrollEasingEnabled = fn;
}

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

const ICON_DEFAULT_SIZE = 16;

// Intrinsic content size of an element on ONE axis. Deliberately per-axis:
// layoutScroll totals every child's main-axis size each frame, and for a
// vertical scroll that axis is HEIGHT — a constant for text/input. Resolving it
// must not trigger the font width measurement (`func_78256_a`), which is the
// dominant per-frame layout cost on long unvirtualized lists (the chat
// scrollback re-measured all ~100 lines every frame just to total their height).
// Memoized font measurement: layout re-resolves every auto-width text's
// width on every rebuild, and each measurement is a Rhino->Java crossing.
// The glyph metrics are fixed per string, so during a scroll (same strings
// every frame) this turns hundreds of crossings per rebuild into map hits.
// (A mid-session Force Unicode Font toggle would serve stale widths until
// /ct reload — accepted.)
const textWidthCache = new Map<string, number>();

function measureStringWidth(text: string): number {
    const cached = textWidthCache.get(text);
    if (cached !== undefined) return cached;
    const measured: unknown = getMinecraft().field_71466_p.func_78256_a(text);
    const w = Number(measured);
    if (textWidthCache.size >= 8192) textWidthCache.clear();
    textWidthCache.set(text, w);
    return w;
}

function intrinsicAxis(e: Element, axis: "w" | "h"): number {
    switch (e.kind) {
        case "text":
            return axis === "w"
                ? measureStringWidth(extract(e.text)) + TEXT_PAD * 2
                : LINE_H + TEXT_PAD * 2;
        case "input":
            return axis === "w" ? 80 : LINE_H + INPUT_PAD_Y * 2;
        case "image":
            return ICON_DEFAULT_SIZE;
        case "mcItem":
            return 16;
        case "scroll":
            return 0;
        default:
            return containerAxis(e, axis);
    }
}

// One axis of a child for intrinsic sizing: an explicit px wins; grow has no
// intrinsic size and falls back to its content (matching the prior behavior).
function measuredAxis(e: Element, axis: "w" | "h"): number {
    const s = axis === "w" ? e.style.width : e.style.height;
    if (s && s.kind === "px") return s.value;
    return intrinsicAxis(e, axis);
}

function containerAxis(
    c: { style: ContainerStyle; children: Extractable<Child[]> },
    axis: "w" | "h"
): number {
    const pad = resolvePadding(c.style.padding);
    const dir = c.style.direction ?? "col";
    const gap = c.style.gap ?? 0;
    const padAxis = axis === "w" ? pad.l + pad.r : pad.t + pad.b;
    const children = extractChildren(c.children);
    const isMainAxis = dir === "row" ? axis === "w" : axis === "h";
    if (isMainAxis) {
        let sum = 0;
        for (let i = 0; i < children.length; i++) {
            sum += measuredAxis(children[i], axis);
        }
        if (children.length > 1) sum += gap * (children.length - 1);
        return sum + padAxis;
    }
    let max = 0;
    for (let i = 0; i < children.length; i++) {
        const v = measuredAxis(children[i], axis);
        if (v > max) max = v;
    }
    return max + padAxis;
}

function resolveAxis(e: Element, axis: "w" | "h"): number | null {
    const s = axis === "w" ? e.style.width : e.style.height;
    if (!s || s.kind === "auto") return intrinsicAxis(e, axis);
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
    /** Rendered position, eased toward `target` each frame. */
    offset: number;
    /**
     * Where the offset is heading. The wheel accumulates into this so rapid
     * notches stack smoothly; the rendered `offset` chases it. Drag and
     * programmatic jumps set both to the same value (instant, no easing).
     */
    target: number;
    /** Wall-clock ms of the last easing step; 0 forces a snap on first use. */
    animAt: number;
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
const scrollStates: { [id: string]: ScrollState | undefined } = {};

export function getScrollState(id: string): ScrollState {
    let s = scrollStates[id];
    if (s === undefined) {
        s = {
            offset: 0,
            target: 0,
            animAt: 0,
            contentLength: 0,
            axis: "y",
            viewportRect: { x: 0, y: 0, w: 0, h: 0 },
            userOverridden: false,
        };
        scrollStates[id] = s;
    }
    return s;
}

function clampOffset(s: ScrollState, value: number): number {
    const view = s.axis === "x" ? s.viewportRect.w : s.viewportRect.h;
    return Math.max(0, Math.min(Math.max(0, s.contentLength - view), value));
}

/** Jump instantly (no easing): autofollow, chat stick-to-bottom, tab autoscroll. */
export function setScrollOffset(id: string, offset: number): void {
    const s = getScrollState(id);
    const v = clampOffset(s, offset);
    s.offset = v;
    s.target = v;
}

/** Set where the offset eases toward (the smoothed wheel path). */
export function setScrollTarget(id: string, target: number): void {
    const s = getScrollState(id);
    // A stale animAt means this input starts a NEW ease episode. Refresh it so
    // the first advance eases from now instead of hitting the >100ms gap-snap
    // and dumping the whole first notch into one frame.
    const now = Date.now();
    if (now - s.animAt > 100) s.animAt = now;
    s.target = clampOffset(s, target);
}

/**
 * True while any currently-rendering scroll's offset is still easing toward its
 * target. The overlay marks the GUI dirty each frame this returns true so the
 * retained layout keeps rebuilding — and the eased motion actually renders —
 * until it settles. Gated on a fresh `animAt` so a scroll left mid-ease in a
 * hidden tab (never re-laid-out, so never converging) doesn't pin it dirty.
 */
export function anyScrollAnimating(): boolean {
    const now = Date.now();
    for (const id in scrollStates) {
        const s = scrollStates[id];
        if (s === undefined) continue;
        if (now - s.animAt > 80) continue;
        const d = s.target - s.offset;
        if (d > 0.5 || d < -0.5) return true;
    }
    return false;
}

export function advanceScrollForPaint(id: string): number {
    const s = getScrollState(id);
    const viewportMain = s.axis === "x" ? s.viewportRect.w : s.viewportRect.h;
    advanceScrollOffset(s, Math.max(0, s.contentLength - viewportMain));
    return s.offset;
}

// Ease `offset` toward `target` by the wall-clock time since the last step.
// The exponential form is exact under split dt, so advancing more than once per
// frame (wheel hit-test relayout + paint) integrates to the same result.
function advanceScrollOffset(s: ScrollState, maxOffset: number): void {
    if (s.target > maxOffset) s.target = maxOffset;
    else if (s.target < 0) s.target = 0;
    if (s.offset > maxOffset) s.offset = maxOffset;
    else if (s.offset < 0) s.offset = 0;

    const now = Date.now();
    const dt = now - s.animAt;
    s.animAt = now;

    if (!scrollEasingEnabled()) {
        s.offset = s.target;
        return;
    }

    const diff = s.target - s.offset;
    // Zero elapsed time advances nothing (exp(0) = 1). This must NOT snap:
    // the wheel poll's hit-test relayout and the same frame's paint relayout
    // run within the same millisecond, so snapping here bypasses the easing
    // for every frame that has wheel input — raw per-notch jumps.
    if (dt <= 0) return;
    // A long gap (tab switch / low FPS) or sub-pixel remainder: snap so it
    // neither lurches from a stale clock nor asymptotes forever.
    if (dt > 100 || (diff > -0.5 && diff < 0.5)) {
        s.offset = s.target;
        return;
    }
    s.offset = s.target - diff * Math.exp(-dt / SCROLL_SMOOTH_TAU_MS);
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
                (mainSizes[lastGrowIdx] ?? 0) + (leftover - assigned);
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
        else cursor += leftover;
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

    // Advance the eased offset BEFORE extracting children, clamped against
    // last frame's content length. Virtualized lists (the Projects tree,
    // the code view) pick which children exist from this offset at extraction
    // time — extracting first and advancing after made them materialize for
    // the PREVIOUS frame's position, so a fast flick (or the >100ms low-FPS
    // snap in advanceScrollOffset) scrolled the viewport past every
    // materialized row and painted blank until the next rebuild.
    advanceScrollOffset(state, Math.max(0, state.contentLength - mainLen));

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

    // Re-clamp against the freshly measured content (it may have grown or
    // shrunk this frame). Exact under split dt, so the second call adds no
    // extra easing movement.
    const maxOffset = Math.max(0, contentMain - mainLen);
    advanceScrollOffset(state, maxOffset);

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
