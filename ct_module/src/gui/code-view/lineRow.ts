/// <reference types="../../../CTAutocomplete" />

import { Container, Text } from "../lib/components";
import type { Element } from "../lib/layout";
import { COLOR_BY_STATE, ROW_BG_BY_STATE, type DiffState } from "../state/diffPalette";
import { CodeViewColors } from "./lineModel";
import type { LineDecorations, RenderableLine, TokenSpan } from "./lineTypes";
import { joinTokenText, wrapTokensIntoVisualRows } from "./wrap";

export const LINE_H = 10;
export const FOCUS_GUTTER_W = 8;
export const STATE_GUTTER_W = 8;
const LINE_NUM_MIN_W = 16;
const DETAIL_COLUMN_W = 180;
const DETAIL_TRUNCATE_CHARS = 41;

export function effectiveBodyWidth(bodyMaxWidth: number, dec: LineDecorations): number {
    return Math.max(1, bodyMaxWidth - (dec.detail !== undefined ? DETAIL_COLUMN_W + 4 : 0));
}

const STATE_GLYPH: { [k in DiffState]: string } = {
    unknown: " ",
    match: " ",
    edit: "~",
    delete: "-",
    add: "+",
    current: "▶",
};

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
    gutterWidth: number;
    lineNumDigits: number;
    bodyMaxWidth: number;
    showFocusGutter: boolean;
    showStateGutter: boolean;
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
        out.push(Text({ text: t.text, color }));
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

export function buildLineRows(
    line: RenderableLine,
    dec: LineDecorations,
    options: LineRowOptions
): Element[] {
    const effectiveBodyW = effectiveBodyWidth(options.bodyMaxWidth, dec);
    const visualRows = wrapTokensIntoVisualRows(line.tokens, effectiveBodyW);
    const out: Element[] = [];
    for (let i = 0; i < visualRows.length; i++) {
        out.push(buildVisualLineRow(line, dec, options, visualRows[i], i > 0));
    }
    return out;
}

function buildVisualLineRow(
    line: RenderableLine,
    dec: LineDecorations,
    options: LineRowOptions,
    tokens: readonly TokenSpan[],
    continuation: boolean
): Element {
    const state: DiffState = dec.state ?? "unknown";
    const isFocused = dec.isFocused === true;

    let bg = dec.background;
    if (bg === undefined && dec.state !== undefined) {
        bg = ROW_BG_BY_STATE[state];
    }
    if (bg === undefined) bg = line.staticBackground;

    const alpha = dec.alpha !== undefined ? dec.alpha : 1;

    const cursorGlyphText = isFocused ? STATE_GLYPH["current"] : " ";
    const cursorGlyphColor = COLOR_BY_STATE["current"];
    const stateGlyphText = dec.state !== undefined ? STATE_GLYPH[state] : " ";
    const stateGlyphColor =
        dec.state !== undefined
            ? COLOR_BY_STATE[state]
            : (line.staticForeground ?? CodeViewColors.gutter);

    const hideLineNum = dec.hideLineNum === true;
    const lineNumText = hideLineNum || continuation
        ? ""
        : (line.lineNum > 0 ? padLeft(String(line.lineNum), options.lineNumDigits) : "");

    const bodyChildren = bodyChildrenForTokens(tokens, dec, alpha);

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
            padding: { side: "x", value: 4 },
            gap: 4,
            height: { kind: "px", value: LINE_H },
            background: bg,
        },
        children,
    });
}
