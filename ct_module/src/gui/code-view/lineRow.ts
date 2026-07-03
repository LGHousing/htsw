/// <reference types="../../../CTAutocomplete" />

import { Container, Text } from "../lib/components";
import type { ClickInfo, Element, Rect } from "../lib/layout";
import { COLOR_BY_STATE, COLOR_CURSOR, ROW_BG_BY_STATE, type DiffState } from "./diffPalette";
import { CodeViewColors } from "./lineModel";
import type { LineDecorations, LineSelection, RenderableLine, TokenSpan } from "./lineTypes";
import { joinTokenText, wrapTokensIntoVisualRows } from "./wrap";
import { offerLineHover } from "./diagnosticHover";
import { chatWidth } from "../../utils/helpers";
import { COLOR_SELECTION } from "../lib/theme";
import { beginSelection, onRowDrag, selectWord, sourceColAtX } from "./selection";

export const LINE_H = 10;
export const FOCUS_GUTTER_W = 8;
export const STATE_GUTTER_W = 8;
const LINE_NUM_MIN_W = 16;
const DETAIL_COLUMN_W = 180;
const DETAIL_TRUNCATE_CHARS = 41;
const ROW_PAD_X = 4;
const ROW_GAP = 4;
const LINK_HOVER_MARK = 0x8067a7e8 | 0;

export function effectiveBodyWidth(bodyMaxWidth: number, dec: LineDecorations): number {
    return Math.max(1, bodyMaxWidth - (dec.detail !== undefined ? DETAIL_COLUMN_W + 4 : 0));
}

const STATE_GLYPH: { [k in DiffState]: string } = {
    unknown: " ",
    match: " ",
    edit: "~",
    delete: "-",
    add: "+",
};

/** Glyph drawn in the focus gutter on the line the importer is currently on. */
const CURSOR_GLYPH = "▶";

function padLeft(s: string, width: number): string {
    let out = s;
    while (out.length < width) out = " " + out;
    return out;
}

function digitsOf(n: number): number {
    if (n <= 0) return 1;
    let d = 0;
    let x = n;
    while (x > 0) {
        d++;
        x = Math.floor(x / 10);
    }
    return d;
}

export function gutterWidthForLines(maxLine: number): number {
    return Math.max(LINE_NUM_MIN_W, digitsOf(maxLine) * 6 + 4);
}

function applyAlpha(color: number, factor: number): number {
    if (factor >= 1) return color;
    if (factor <= 0) return color & 0x00ffffff;
    const a = (color >>> 24) & 0xff;
    const r = (color >>> 16) & 0xff;
    const g = (color >>> 8) & 0xff;
    const b = color & 0xff;
    const newA = Math.max(0, Math.min(255, Math.round(a * factor)));
    return ((newA << 24) | (r << 16) | (g << 8) | b) | 0;
}

export type LineRowOptions = {
    scrollId: string;
    gutterWidth: number;
    lineNumDigits: number;
    bodyMaxWidth: number;
    showFocusGutter: boolean;
    showStateGutter: boolean;
    onOpenPath?: (path: string, options: { activate: boolean }) => void;
};

function tokenElements(
    tokens: readonly TokenSpan[],
    overrideColor: number | undefined,
    alpha: number
): Element[] {
    const out: Element[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const baseColor = overrideColor !== undefined ? overrideColor : t.color;
        const color = alpha < 1 ? applyAlpha(baseColor, alpha) : baseColor;
        out.push(Text({
            text: t.text,
            color,
            underlineColor: t.underlineColor,
        }));
    }
    return out;
}

function bodyChildrenForTokens(
    tokens: readonly TokenSpan[],
    dec: LineDecorations,
    alpha: number
): Element[] {
    if (dec.italic === true) {
        const combined = joinTokenText(tokens);
        const baseColor = dec.foregroundColor !== undefined
            ? dec.foregroundColor
            : (tokens.length > 0 ? tokens[0].color : CodeViewColors.gutter);
        const textColor = alpha < 1 ? applyAlpha(baseColor, alpha) : baseColor;
        return [
            Text({
                text: `§o${combined}§r`,
                color: textColor,
            }),
        ];
    }
    return tokenElements(tokens, dec.foregroundColor, alpha);
}

function rowSrcRange(tokens: readonly TokenSpan[]): { start: number; end: number } {
    if (tokens.length === 0) return { start: 0, end: 0 };
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    return {
        start: first.srcStart ?? 0,
        end: (last.srcStart ?? 0) + last.text.length,
    };
}

function buildBodyChildren(
    tokens: readonly TokenSpan[],
    dec: LineDecorations,
    alpha: number,
    lineSelection: LineSelection | null
): Element[] {
    if (lineSelection === null) return bodyChildrenForTokens(tokens, dec, alpha);
    const range = rowSrcRange(tokens);
    const segStart = Math.max(lineSelection.start, range.start);
    const segEnd = Math.min(lineSelection.end, range.end);
    const marginExtend =
        lineSelection.start < range.end &&
        lineSelection.end >= range.end &&
        (lineSelection.end > range.end || lineSelection.continuesRight);
    if (segStart >= segEnd && !marginExtend) {
        return bodyChildrenForTokens(tokens, dec, alpha);
    }
    return selectionBodyChildren(tokens, dec, alpha, segStart, segEnd, marginExtend);
}

function selectionBox(children: Element[]): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            width: { kind: "auto" },
            height: { kind: "px", value: LINE_H },
            background: COLOR_SELECTION,
        },
        children,
    });
}

function marginBox(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "px", value: LINE_H },
            background: COLOR_SELECTION,
        },
        children: [],
    });
}

function selectionBodyChildren(
    tokens: readonly TokenSpan[],
    dec: LineDecorations,
    alpha: number,
    segStart: number,
    segEnd: number,
    marginExtend: boolean
): Element[] {
    if (dec.italic === true) {
        const combined = joinTokenText(tokens);
        const base = dec.foregroundColor !== undefined
            ? dec.foregroundColor
            : (tokens.length > 0 ? tokens[0].color : CodeViewColors.gutter);
        const color = alpha < 1 ? applyAlpha(base, alpha) : base;
        const text = Text({ text: `§o${combined}§r`, color });
        const out: Element[] = segStart < segEnd ? [selectionBox([text])] : [text];
        if (marginExtend) out.push(marginBox());
        return out;
    }
    const out: Element[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const tStart = t.srcStart ?? 0;
        const tEnd = tStart + t.text.length;
        const baseColor = dec.foregroundColor !== undefined ? dec.foregroundColor : t.color;
        const color = alpha < 1 ? applyAlpha(baseColor, alpha) : baseColor;
        const from = Math.max(segStart, tStart);
        const to = Math.min(segEnd, tEnd);
        if (from >= to) {
            out.push(Text({ text: t.text, color, underlineColor: t.underlineColor }));
            continue;
        }
        const a = from - tStart;
        const b = to - tStart;
        if (a > 0) {
            out.push(Text({ text: t.text.substring(0, a), color, underlineColor: t.underlineColor }));
        }
        out.push(
            selectionBox([
                Text({ text: t.text.substring(a, b), color, underlineColor: t.underlineColor }),
            ])
        );
        if (b < t.text.length) {
            out.push(Text({ text: t.text.substring(b), color, underlineColor: t.underlineColor }));
        }
    }
    if (marginExtend) out.push(marginBox());
    return out;
}

export function buildLineRows(
    line: RenderableLine,
    dec: LineDecorations,
    options: LineRowOptions,
    lineSelection: LineSelection | null
): Element[] {
    const effectiveBodyW = effectiveBodyWidth(options.bodyMaxWidth, dec);
    const visualRows = wrapTokensIntoVisualRows(line.tokens, effectiveBodyW);
    const out: Element[] = [];
    for (let i = 0; i < visualRows.length; i++) {
        out.push(buildVisualLineRow(line, dec, options, visualRows[i], i > 0, lineSelection));
    }
    return out;
}

function buildVisualLineRow(
    line: RenderableLine,
    dec: LineDecorations,
    options: LineRowOptions,
    tokens: readonly TokenSpan[],
    continuation: boolean,
    lineSelection: LineSelection | null
): Element {
    const state: DiffState = dec.state ?? "unknown";
    const isFocused = dec.isFocused === true;

    let bg = dec.background;
    if (bg === undefined && dec.state !== undefined) {
        bg = ROW_BG_BY_STATE[state];
    }
    if (bg === undefined) bg = line.staticBackground;

    const alpha = dec.alpha !== undefined ? dec.alpha : 1;

    const cursorGlyphText = isFocused ? CURSOR_GLYPH : " ";
    const cursorGlyphColor = COLOR_CURSOR;
    const stateGlyphText = dec.state !== undefined ? STATE_GLYPH[state] : " ";
    const stateGlyphColor =
        dec.state !== undefined
            ? COLOR_BY_STATE[state]
            : (line.staticForeground ?? CodeViewColors.gutter);

    const hideLineNum = dec.hideLineNum === true;
    const lineNumText = hideLineNum || continuation
        ? ""
        : (line.lineNum > 0 ? padLeft(String(line.lineNum), options.lineNumDigits) : "");

    const bodyChildren = buildBodyChildren(tokens, dec, alpha, lineSelection);
    const hasLinkedToken = hasLink(tokens);
    const scrollId = options.scrollId;
    const onClick = (rect: Rect, info: ClickInfo) => {
        if (info.button !== 0 && info.button !== 2) return;
        const localX = info.x - bodyX(rect, options);
        if (options.onOpenPath !== undefined && hasLinkedToken) {
            const target = linkTargetAt(tokens, localX);
            if (target !== null) {
                if (!info.isDoubleClickSecond) {
                    options.onOpenPath(target, { activate: info.button === 0 });
                }
                return;
            }
        }
        if (info.button !== 0) return;
        const col = sourceColAtX(tokens, localX);
        if (info.isDoubleClickSecond) selectWord(scrollId, line.id, col);
        else beginSelection(scrollId, line.id, col);
    };

    const children: Element[] = [];
    if (options.showFocusGutter) {
        children.push(Container({
            style: {
                direction: "row",
                align: "center",
                justify: "center",
                width: { kind: "px", value: FOCUS_GUTTER_W },
                height: { kind: "grow" },
                background: dec.cursorColumnBackground,
            },
            children: [
                Text({
                    text: continuation ? " " : cursorGlyphText,
                    color: applyAlpha(cursorGlyphColor, alpha),
                }),
            ],
        }));
    }
    if (options.showStateGutter) {
        children.push(Text({
            text: continuation ? " " : stateGlyphText,
            color: applyAlpha(stateGlyphColor, alpha),
            style: { width: { kind: "px", value: STATE_GUTTER_W } },
        }));
    }
    children.push(
        Text({
            text: lineNumText,
            color: applyAlpha(CodeViewColors.gutter, alpha),
            style: { width: { kind: "px", value: options.gutterWidth } },
        }),
        Container({
            style: {
                direction: "row",
                width: { kind: "grow" },
                height: { kind: "grow" },
                align: "center",
                gap: 0,
            },
            children: bodyChildren,
        })
    );

    if (dec.detail !== undefined && dec.detail.length > 0) {
        children.push(
            Text({
                text: continuation
                    ? ""
                    : dec.detail.length > DETAIL_TRUNCATE_CHARS + 1
                    ? dec.detail.substring(0, DETAIL_TRUNCATE_CHARS) + "…"
                    : dec.detail,
                color: applyAlpha(
                    dec.foregroundColor ?? CodeViewColors.gutter,
                    alpha
                ),
                style: { width: { kind: "px", value: DETAIL_COLUMN_W } },
            })
        );
    }

    return Container({
        style: {
            direction: "row",
            padding: { side: "x", value: ROW_PAD_X },
            gap: ROW_GAP,
            height: { kind: "px", value: LINE_H },
            background: bg,
        },
        onClick,
        onHover: (rect, mouseX) => {
            const localX = mouseX - bodyX(rect, options);
            onRowDrag(scrollId, line.id, tokens, localX);
            if (hasLinkedToken) {
                const run = linkRunAt(tokens, localX);
                if (run !== null) {
                    drawLinkHoverMark(rect, bodyX(rect, options) + run.start, run.width);
                }
            }
            if (
                (line.diagnostics !== undefined && line.diagnostics.length > 0) ||
                dec.hoverLines !== undefined
            ) {
                offerLineHover(
                    rect,
                    mouseX,
                    line.diagnostics,
                    line.diagnosticParse,
                    dec.hoverLines?.() ?? undefined
                );
            }
        },
        children,
    });
}

function hasLink(tokens: readonly TokenSpan[]): boolean {
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].linkTarget !== undefined) return true;
    }
    return false;
}

function bodyX(rect: Rect, options: LineRowOptions): number {
    let x = rect.x + ROW_PAD_X;
    if (options.showFocusGutter) x += FOCUS_GUTTER_W + ROW_GAP;
    if (options.showStateGutter) x += STATE_GUTTER_W + ROW_GAP;
    return x + options.gutterWidth + ROW_GAP;
}

function linkTargetAt(tokens: readonly TokenSpan[], x: number): string | null {
    const run = linkRunAt(tokens, x);
    return run === null ? null : run.target;
}

function linkRunAt(
    tokens: readonly TokenSpan[],
    x: number
): { target: string; start: number; width: number } | null {
    if (x < 0) return null;
    let cursor = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const w = chatWidth(token.text, false);
        if (x >= cursor && x < cursor + w) {
            return token.linkTarget === undefined
                ? null
                : { target: token.linkTarget, start: cursor, width: w };
        }
        cursor += w;
    }
    return null;
}

function drawLinkHoverMark(rowRect: Rect, x: number, width: number): void {
    const y = rowRect.y + rowRect.h - 1;
    const end = x + width;
    for (let px = x; px < end; px += 2) {
        Renderer.drawRect(LINK_HOVER_MARK, px, y - ((px - x) % 4 === 0 ? 1 : 0), 1, 1);
    }
}
