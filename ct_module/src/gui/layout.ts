/// <reference types="../../CTAutocomplete" />

import { Extractable, extract } from "./extractable";

export type PaddingSide = "all" | "x" | "y" | "top" | "right" | "bottom" | "left";

export type PaddingEntry = { side: PaddingSide; value: number };
export type Padding = number | PaddingEntry | PaddingEntry[];

export type Size =
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
    align?: "start" | "center" | "end" | "stretch";
};

export type Child = Element | false;

export type Element =
    | {
          kind: "container";
          style: ContainerStyle;
          children: Extractable<Child[]>;
          onClick?: (rect: Rect, isDoubleClickSecond: boolean) => void;
          onDoubleClick?: (rect: Rect) => void;
      }
    | {
          kind: "button";
          style: Style;
          text: Extractable<string>;
          onClick: (rect: Rect, isDoubleClickSecond: boolean) => void;
          onDoubleClick?: (rect: Rect) => void;
      }
    | {
          kind: "text";
          style: Style;
          text: Extractable<string>;
          color?: Extractable<number | undefined>;
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
      };

export function extractChildren(c: Extractable<Child[]>): Element[] {
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
const BUTTON_PAD_X = 4;
const BUTTON_PAD_Y = 4;
const INPUT_PAD_Y = 6;
const TEXT_PAD = 0;
const SCROLLBAR_W = 4;

export function resolvePadding(p: Padding | undefined): ResolvedPadding {
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

function buttonContent(text: string): { w: number; h: number } {
    return {
        w: Renderer.getStringWidth(text) + BUTTON_PAD_X * 2,
        h: LINE_H + BUTTON_PAD_Y * 2,
    };
}

function textContent(text: string): { w: number; h: number } {
    return { w: Renderer.getStringWidth(text) + TEXT_PAD * 2, h: LINE_H + TEXT_PAD * 2 };
}

function inputContent(_: string): { w: number; h: number } {
    return { w: 80, h: LINE_H + INPUT_PAD_Y * 2 };
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
    if (e.kind === "button") content = buttonContent(extract(e.text));
    else if (e.kind === "text") content = textContent(extract(e.text));
    else if (e.kind === "input") content = inputContent(extract(e.value));
    else if (e.kind === "scroll") content = { w: 0, h: 0 };
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

// Per-id scroll state. Reset across reloads but persists across frames.
type ScrollState = { offset: number; contentHeight: number; viewportRect: Rect };
const scrollStates: { [id: string]: ScrollState } = {};

export function getScrollState(id: string): ScrollState {
    let s = scrollStates[id];
    if (!s) {
        s = { offset: 0, contentHeight: 0, viewportRect: { x: 0, y: 0, w: 0, h: 0 } };
        scrollStates[id] = s;
    }
    return s;
}

export function scrollBy(id: string, delta: number): void {
    const s = getScrollState(id);
    s.offset = Math.max(
        0,
        Math.min(s.contentHeight - s.viewportRect.h, s.offset + delta)
    );
    if (s.offset < 0) s.offset = 0;
}

export function setScrollOffset(id: string, offset: number): void {
    const s = getScrollState(id);
    s.offset = Math.max(
        0,
        Math.min(Math.max(0, s.contentHeight - s.viewportRect.h), offset)
    );
}

export function getAllScrollIds(): string[] {
    const out: string[] = [];
    for (const k in scrollStates) out.push(k);
    return out;
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

    let cursor = isRow ? innerX : innerY;
    for (let i = 0; i < n; i++) {
        const ch = children[i];
        const mSize = mainSizes[i] as number;

        const explicitCross = crossAxis === "w" ? ch.style.width : ch.style.height;
        const crossResolved = resolveAxis(ch, crossAxis);
        let cSize: number;
        if (crossResolved === null) cSize = crossLen;
        else if (align === "stretch" && (!explicitCross || explicitCross.kind === "auto"))
            cSize = crossLen;
        else cSize = Math.min(crossResolved, crossLen);

        const crossOriginIn = isRow ? innerY : innerX;
        let crossOff = crossOriginIn;
        if (align === "center")
            crossOff = crossOriginIn + Math.floor((crossLen - cSize) / 2);
        else if (align === "end") crossOff = crossOriginIn + (crossLen - cSize);

        const rect: Rect = isRow
            ? { x: cursor, y: crossOff, w: mSize, h: cSize }
            : { x: crossOff, y: cursor, w: cSize, h: mSize };

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
    const innerW = Math.max(0, w - pad.l - pad.r);
    const innerH = Math.max(0, h - pad.t - pad.b);
    const gap = s.style.gap ?? 0;
    const align = s.style.align ?? "stretch";

    const state = getScrollState(s.id);
    state.viewportRect = { x: x + pad.l, y: y + pad.t, w: innerW, h: innerH };
    const viewportRect = state.viewportRect;

    const children = extractChildren(s.children);
    const n = children.length;

    // Compute total content height first by resolving each child's main-axis size.
    let contentH = 0;
    const sizes: number[] = [];
    for (let i = 0; i < n; i++) {
        const m = resolveAxis(children[i], "h");
        const v = m === null ? 0 : m;
        sizes.push(v);
        contentH += v;
    }
    if (n > 1) contentH += gap * (n - 1);
    state.contentHeight = contentH;

    // Clamp offset.
    const maxOffset = Math.max(0, contentH - innerH);
    if (state.offset > maxOffset) state.offset = maxOffset;
    if (state.offset < 0) state.offset = 0;

    // Place children with offset applied. Cross-axis = stretch into innerW (no scrollbar reservation).
    let cursor = y + pad.t - state.offset;
    for (let i = 0; i < n; i++) {
        const ch = children[i];
        const mSize = sizes[i];

        const explicitCross = ch.style.width;
        const crossResolved = resolveAxis(ch, "w");
        let cSize: number;
        if (crossResolved === null) cSize = innerW;
        else if (align === "stretch" && (!explicitCross || explicitCross.kind === "auto"))
            cSize = innerW;
        else cSize = Math.min(crossResolved, innerW);

        let crossOff = innerX;
        if (align === "center") crossOff = innerX + Math.floor((innerW - cSize) / 2);
        else if (align === "end") crossOff = innerX + (innerW - cSize);

        const rect: Rect = { x: crossOff, y: cursor, w: cSize, h: mSize };
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
