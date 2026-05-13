/// <reference types="../../../CTAutocomplete" />

/**
 * Render a single source line to an `Element` tree. Pure builder — takes
 * a data-only `RenderableLine` plus per-line `LineDecorations` from a
 * `LineDecorator`. Shared by the View tab (static diff colors) and the
 * Import tab's live preview.
 *
 * Layout (left to right):
 *   [ 8px focus-glyph ] [ N px line-num ] [ grow text tokens ] [ optional detail ]
 *
 * The focus-glyph column is reserved even when no decoration is set so
 * gutters stay aligned across consecutive rows.
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
export const BRACKET_GUTTER_W = 6;

/** Glyph drawn in the focus gutter per diff state. */
export const STATE_GLYPH: { [k in DiffState]: string } = {
    unknown: " ",
    match: "✓",
    edit: "~",
    delete: "-",
    add: "+",
    current: "▶",
};

/** Glyphs forming the multi-line "[" bracket. */
const BRACKET_GLYPH = {
    top: "┌",
    middle: "│",
    bottom: "└",
};
const COLOR_BRACKET = 0xff67a7e8 | 0; // blue, matches the focus arrow

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
 * Mix a foreground color toward gray by `t` (0..1). Used by the
 * progressDecorator for the gray→vibrant fade-in animation.
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

const FIELD_FOCUS_BG = 0x4067a7e8 | 0; // translucent blue, matches focus arrow

function tokenElements(
    tokens: TokenSpan[],
    overrideColor: number | undefined,
    alpha: number,
    underlinedFields: { [prop: string]: true } | undefined,
    focusedFieldProp: string | undefined
): Element[] {
    const out: Element[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const baseColor = overrideColor !== undefined ? overrideColor : t.color;
        const color = alpha < 1 ? applyAlpha(baseColor, alpha) : baseColor;
        const underline =
            underlinedFields !== undefined &&
            t.fieldProp !== undefined &&
            underlinedFields[t.fieldProp] === true;
        const isFocusedField =
            focusedFieldProp !== undefined &&
            t.fieldProp !== undefined &&
            t.fieldProp === focusedFieldProp;
        const textEl = Text({
            text: t.text,
            color,
            style: { underline },
        });
        if (isFocusedField) {
            // Wrap in a thin-padded Container with a translucent blue
            // background so the token reads as the "field box" the
            // importer is currently editing.
            out.push(
                Container({
                    style: {
                        direction: "row",
                        align: "center",
                        background: FIELD_FOCUS_BG,
                    },
                    children: [textEl],
                })
            );
        } else {
            out.push(textEl);
        }
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

    // Foreground glyph color (gutter glyph + line number).
    let glyphColor: number;
    if (dec.foregroundColor !== undefined) {
        glyphColor = dec.foregroundColor;
    } else if (dec.state !== undefined) {
        glyphColor = COLOR_BY_STATE[state];
    } else if (line.staticForeground !== undefined) {
        glyphColor = line.staticForeground;
    } else {
        glyphColor = CodeViewColors.gutter;
    }

    const alpha = dec.alpha !== undefined ? dec.alpha : 1;

    // Cursor (▶) lives in its own column to the LEFT of the diff state
    // glyph (+/~/-/✓), so the user can read both signals at a glance:
    // "what's happening right now" vs "what's planned for this line".
    const cursorGlyphText = isFocused ? STATE_GLYPH["current"] : " ";
    const cursorGlyphColor = COLOR_BY_STATE["current"];
    const stateGlyphText = dec.state !== undefined ? STATE_GLYPH[state] : " ";
    // State glyph always uses the diff state's vibrant color when set,
    // ignoring dec.foregroundColor — pending lines have foregroundColor
    // set to COLOR_PENDING_GRAY which would otherwise wash out the glyph
    // (a "+" should be bright green even on a gray-pending line).
    const stateGlyphColor =
        dec.state !== undefined ? COLOR_BY_STATE[state] : glyphColor;

    const hideLineNum = dec.hideLineNum === true;
    const lineNumText = hideLineNum
        ? ""
        : (line.lineNum > 0 ? padLeft(String(line.lineNum), 3) : "");

    const bracketGlyph = dec.bracketRole === undefined
        ? ""
        : BRACKET_GLYPH[dec.bracketRole];

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
        bodyChildren = tokenElements(
            line.tokens,
            dec.foregroundColor,
            alpha,
            dec.underlinedFields,
            dec.focusedFieldProp
        );
    }

    const children: Element[] = [
        // Bracket gutter — reserves the column even when empty so all rows
        // line up. Rendered first (leftmost).
        Text({
            text: bracketGlyph,
            color: COLOR_BRACKET,
            style: { width: { kind: "px", value: BRACKET_GUTTER_W } },
        }),
        // Cursor column: only ever shows the blue ▶ for the line the
        // importer is touching this instant. Always reserved so other
        // columns don't shift when the cursor jumps to a new line.
        // When `cursorColumnBackground` is set the column gets a tinted
        // background — used for the apply-phase focus indicator so a
        // tall blue box runs through the cursor column without
        // overriding the row's own diff state colour.
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
        // State column: +/~/-/✓ glyph for the planned diff op on this
        // line. Independent of cursor position so the user can read
        // both at the same time.
        Text({
            text: stateGlyphText,
            color: applyAlpha(stateGlyphColor, alpha),
            style: { width: { kind: "px", value: STATE_GUTTER_W } },
        }),
        // Line number: tinted with the diff state's color when set, so
        // an `add` line shows a green line number, `delete` red, `edit`
        // gold — same git-style cue the +/~/- glyph carries. Untouched
        // lines stay neutral gutter-gray.
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
                color: applyAlpha(glyphColor, alpha),
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
