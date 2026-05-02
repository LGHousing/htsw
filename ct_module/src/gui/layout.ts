/// <reference types="../../CTAutocomplete" />

import { Extractable, extract } from "./extractable";

export type PaddingSide =
    | "all"
    | "x"
    | "y"
    | "top"
    | "right"
    | "bottom"
    | "left";

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
};

export type ContainerStyle = Style & {
    direction?: "row" | "col";
    gap?: number;
    align?: "start" | "center" | "end" | "stretch";
    background?: number;
};

export type Element =
    | { kind: "container"; style: ContainerStyle; children: Extractable<Element[]> }
    | { kind: "button"; style: Style; text: Extractable<string>; onClick: () => void };

export type Rect = { x: number; y: number; w: number; h: number };
export type LaidOut = { element: Element; rect: Rect };

type ResolvedPadding = { t: number; r: number; b: number; l: number };

const CHAR_W = 6;
const LINE_H = 8;
const BUTTON_PAD_X = 4;
const BUTTON_PAD_Y = 4;

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
            case "all": out.t = out.r = out.b = out.l = v; break;
            case "x":   out.l = out.r = v; break;
            case "y":   out.t = out.b = v; break;
            case "top": out.t = v; break;
            case "right": out.r = v; break;
            case "bottom": out.b = v; break;
            case "left": out.l = v; break;
        }
    }
    return out;
}

function isPaddingEntry(p: PaddingEntry | PaddingEntry[]): p is PaddingEntry {
    return !(p instanceof Array);
}

// Intrinsic content size (ignores style.width/height — those are layered on by `measure`).
function buttonContent(text: string): { w: number; h: number } {
    return { w: text.length * CHAR_W + BUTTON_PAD_X * 2, h: LINE_H + BUTTON_PAD_Y * 2 };
}

function containerContent(c: { style: ContainerStyle; children: Extractable<Element[]> }): { w: number; h: number } {
    const pad = resolvePadding(c.style.padding);
    const dir = c.style.direction ?? "col";
    const gap = c.style.gap ?? 0;
    const children = extract(c.children);
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

// Intrinsic size of an element. `px` overrides; `grow` falls back to content (used only as a hint
// for cross-axis measurement of a parent — actual grow distribution happens during layout).
function measure(e: Element): { w: number; h: number } {
    const content = e.kind === "button" ? buttonContent(extract(e.text)) : containerContent(e);
    const w = e.style.width;
    const h = e.style.height;
    return {
        w: w && w.kind === "px" ? w.value : content.w,
        h: h && h.kind === "px" ? h.value : content.h,
    };
}

// Returns a concrete size, or null if the child wants to grow on this axis.
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

export function layoutElement(root: Element, x: number, y: number, w: number, h: number): LaidOut[] {
    const out: LaidOut[] = [];
    out.push({ element: root, rect: { x, y, w, h } });
    if (root.kind === "container") {
        layoutContainer(root, x, y, w, h, out);
    }
    return out;
}

function layoutContainer(
    c: { kind: "container"; style: ContainerStyle; children: Extractable<Element[]> },
    x: number,
    y: number,
    w: number,
    h: number,
    out: LaidOut[]
): void {
    const pad = resolvePadding(c.style.padding);
    const innerX = x + pad.l;
    const innerY = y + pad.t;
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

    const children = extract(c.children);
    const n = children.length;
    if (n === 0) return;

    // Pass 1: resolve main-axis sizes (null = grow, deferred).
    const mainSizes: (number | null)[] = [];
    let fixedSum = 0;
    for (let i = 0; i < n; i++) {
        const m = resolveAxis(children[i], mainAxis);
        mainSizes.push(m);
        if (m !== null) fixedSum += m;
    }
    const gapSum = n > 1 ? gap * (n - 1) : 0;
    const leftover = Math.max(0, mainLen - fixedSum - gapSum);

    // Pass 2: distribute leftover across grow children. Last grow child eats the floor remainder
    // so totals match the inner length exactly.
    let growTotal = 0;
    for (let i = 0; i < n; i++) {
        if (mainSizes[i] === null) growTotal += growFactorOf(children[i], mainAxis);
    }
    if (growTotal > 0) {
        let assigned = 0;
        let lastGrowIdx = -1;
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
            mainSizes[lastGrowIdx] = (mainSizes[lastGrowIdx] as number) + (leftover - assigned);
        }
    } else {
        for (let i = 0; i < n; i++) if (mainSizes[i] === null) mainSizes[i] = 0;
    }

    // Pass 3: place children, resolving cross-axis size + alignment per child.
    let cursor = isRow ? innerX : innerY;
    for (let i = 0; i < n; i++) {
        const ch = children[i];
        const mSize = mainSizes[i] as number;

        const explicitCross = crossAxis === "w" ? ch.style.width : ch.style.height;
        const crossResolved = resolveAxis(ch, crossAxis);
        let cSize: number;
        if (crossResolved === null) {
            // grow on cross axis: fill the inner cross length.
            cSize = crossLen;
        } else if (align === "stretch" && (!explicitCross || explicitCross.kind === "auto")) {
            // No explicit cross size + stretch alignment => fill, like flex default.
            cSize = crossLen;
        } else {
            cSize = Math.min(crossResolved, crossLen);
        }

        const crossOriginIn = isRow ? innerY : innerX;
        let crossOff = crossOriginIn;
        if (align === "center") crossOff = crossOriginIn + Math.floor((crossLen - cSize) / 2);
        else if (align === "end") crossOff = crossOriginIn + (crossLen - cSize);

        const rect: Rect = isRow
            ? { x: cursor, y: crossOff, w: mSize, h: cSize }
            : { x: crossOff, y: cursor, w: cSize, h: mSize };

        out.push({ element: ch, rect });
        if (ch.kind === "container") {
            layoutContainer(ch, rect.x, rect.y, rect.w, rect.h, out);
        }

        cursor += mSize + gap;
    }
}

export function pointInRect(r: Rect, x: number, y: number): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
