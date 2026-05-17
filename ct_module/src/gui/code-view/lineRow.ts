/// <reference types="../../../CTAutocomplete" />

/**
 * Render a single source line to an `Element` tree. Pure builder — takes
 * a data-only `RenderableLine` plus per-line `LineDecorations` from a
 * `LineDecorator`. Shared by the View tab (static diff colours) and the
 * Import tab's live preview.
 *
 * Row layout (left to right):
 *   [ 8px cursor (▶) ]
 *   [ 8px state glyph (+/~/-/✓) ]
 *   [ N px line-num ]
 *   [ grow text tokens ]
 *   [ optional 180px detail ]
 *
 * Cursor and state glyph live in separate columns so the user can read
 * "what's happening right now" (▶) and "what's planned for this line"
 * (+/~/-/✓) at the same time.
 */

import { Container, Text } from "../lib/components";
import type { Element } from "../lib/layout";
import { COLOR_BY_STATE, ROW_BG_BY_STATE, type DiffState } from "../state/diff";
import { CodeViewColors } from "./lineModel";
import type { LineDecorations, RenderableLine, TokenSpan } from "./types";

export const LINE_H = 10;
export const FOCUS_GUTTER_W = 8;
export const STATE_GUTTER_W = 8;
export const LINE_NUM_MIN_W = 16;

/** Glyph drawn in each gutter column per diff state. */
export const STATE_GLYPH: { [k in DiffState]: string } = {
    unknown: " ",
    match: "✓",
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

/** Compute the gutter width needed to print N right-aligned. */
export function gutterWidthForLines(maxLine: number): number {
    return Math.max(LINE_NUM_MIN_W, digitsOf(maxLine) * 6 + 4);
}

/**
 * Mix a foreground color toward gray by `t` (0..1). Used by callers
 * that want a soft fade — the morph preview doesn't drive this currently
 * but the helper is still useful for synthesised lines.
 */
export function lerpColorToward(target: number, base: number, t: number): number {
    if (t >= 1) return target;
    if (t <= 0) return base;
    const ta = (target >>> 24) & 0xff;
    const tr = (target >>> 16) & 0xff;
    const tg = (target >>> 8) & 0xff;
    const tb = target & 0xff;
    const ba = (base >>> 24) & 0xff;
    const br = (base >>> 16) & 0xff;
    const bg = (base >>> 8) & 0xff;
    const bb = base & 0xff;
    const a = Math.round(ba + (ta - ba) * t);
    const r = Math.round(br + (tr - br) * t);
    const g = Math.round(bg + (tg - bg) * t);
    const b = Math.round(bb + (tb - bb) * t);
    return ((a << 24) | (r << 16) | (g << 8) | b) | 0;
}

/** Apply an opacity factor to a color's alpha channel. */
export function applyAlpha(color: number, factor: number): number {
    if (factor >= 1) return color;
    if (factor <= 0) return color & 0x00ffffff;
    const a = (color >>> 24) & 0xff;
    const r = (color >>> 16) & 0xff;
    const g = (color >>> 8) & 0xff;
    const b = color & 0xff;
    const newA = Math.max(0, Math.min(255, Math.round(a * factor)));
    return ((newA << 24) | (r << 16) | (g << 8) | b) | 0;
}

function tokenElements(
    tokens: TokenSpan[],
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

/**
 * Build the Element tree for one source line. Combines static line data
 * (text, gutter number) with dynamic decoration (state glyph, background,
 * focus override).
 */
export function buildLineRow(
    line: RenderableLine,
    dec: LineDecorations,
    gutterWidth: number
): Element {
    const state: DiffState = dec.state ?? "unknown";
    const isFocused = dec.isFocused === true;

    // Background: explicit decorator override > diff-state row tint > static (diagnostic).
    let bg = dec.background;
    if (bg === undefined && dec.state !== undefined) {
        bg = ROW_BG_BY_STATE[state];
    }
    if (bg === undefined) bg = line.staticBackground;

    const alpha = dec.alpha !== undefined ? dec.alpha : 1;

    const cursorGlyphText = isFocused ? STATE_GLYPH["current"] : " ";
    const cursorGlyphColor = COLOR_BY_STATE["current"];
    const stateGlyphText = dec.state !== undefined ? STATE_GLYPH[state] : " ";
    // State glyph always uses the diff state's vibrant color when set,
    // ignoring dec.foregroundColor — pending lines have foregroundColor
    // set to COLOR_PENDING_GRAY which would otherwise wash out the glyph
    // (a "+" should be bright green even on a gray-pending line).
    const stateGlyphColor =
        dec.state !== undefined
            ? COLOR_BY_STATE[state]
            : (line.staticForeground ?? CodeViewColors.gutter);

    const hideLineNum = dec.hideLineNum === true;
    const lineNumText = hideLineNum
        ? ""
        : (line.lineNum > 0 ? padLeft(String(line.lineNum), 3) : "");

    // Italic body text: render the entire line as a single §o-prefixed
    // Text element rather than per-token Texts. The §o code formats
    // everything to the next §r (or end-of-string); MC's font renderer
    // resets formatting on newlines automatically. Per-token italic
    // would let tokens drift apart since each Text is its own draw call.
    let bodyChildren: Element[];
    if (dec.italic === true) {
        let combined = "";
        const tokens = line.tokens;
        for (let i = 0; i < tokens.length; i++) combined += tokens[i].text;
        const baseColor = dec.foregroundColor !== undefined
            ? dec.foregroundColor
            : (tokens.length > 0 ? tokens[0].color : CodeViewColors.gutter);
        const textColor = alpha < 1 ? applyAlpha(baseColor, alpha) : baseColor;
        bodyChildren = [
            Text({
                text: `§o${combined}§r`,
                color: textColor,
            }),
        ];
    } else {
        bodyChildren = tokenElements(line.tokens, dec.foregroundColor, alpha);
    }

    const children: Element[] = [
        // Cursor column: only shows ▶ for the line the importer is touching
        // this instant. `cursorColumnBackground` paints a tall blue strip
        // through this column without overriding the row's diff-state tint —
        // used during apply for the focus indicator.
        Container({
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
                    text: cursorGlyphText,
                    color: applyAlpha(cursorGlyphColor, alpha),
                }),
            ],
        }),
        // State column: +/~/-/✓ glyph for the planned diff op.
        Text({
            text: stateGlyphText,
            color: applyAlpha(stateGlyphColor, alpha),
            style: { width: { kind: "px", value: STATE_GUTTER_W } },
        }),
        // Line number: tinted with the diff state's color when set
        // (git-style cue), neutral gutter-gray otherwise.
        Text({
            text: lineNumText,
            color: applyAlpha(
                dec.state !== undefined ? COLOR_BY_STATE[state] : CodeViewColors.gutter,
                alpha
            ),
            style: { width: { kind: "px", value: gutterWidth } },
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
        }),
    ];

    if (dec.detail !== undefined && dec.detail.length > 0) {
        children.push(
            Text({
                text: dec.detail.length > 42 ? dec.detail.substring(0, 41) + "…" : dec.detail,
                color: applyAlpha(
                    dec.foregroundColor ?? CodeViewColors.gutter,
                    alpha
                ),
                style: { width: { kind: "px", value: 180 } },
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
