/// <reference types="../../../CTAutocomplete" />

/**
 * Shared text/code-view data types.
 *
 * The code-view module turns a file path into a list of decorated lines and
 * renders them inside a Scroll. It is the single source of truth for source
 * preview UI — both the right panel's View tab (static diff colors) and the
 * Import tab's live preview (animated freshness + focus cursor) compose
 * against the same primitives via `LineDecorator`.
 */

import type { SyntaxToken } from "../right-panel/syntax";
import type { DiffState } from "../state/diff";

/**
 * Per-token tag pointing back to the AST field this token belongs to.
 * Populated by the field-span-aware printer for HTSL action lines; empty
 * for plain text / unknown tokens.
 */
export type TokenSpan = SyntaxToken & {
    /** Property name in the source `Action` (e.g. `"message"`, `"title"`). */
    fieldProp?: string;
    /** Stable identity for animation/decoration overlays. */
    spanId?: string;
    /** Whether the renderer should draw an underline under this token. */
    underline?: boolean;
};

/**
 * Field-span metadata produced by the printer alongside a line's text.
 * Each entry covers a half-open character range `[start, end)` in the line.
 */
export type FieldSpan = {
    prop: string;
    start: number;
    end: number;
};

/**
 * A single line of file content prepared for rendering. Data-only; no
 * element-tree construction here. Decoration (state colors, glyphs, focus
 * indicators) is applied later by a `LineDecorator`.
 */
export type RenderableLine = {
    /** Stable id used by decorators to look up per-line state. */
    id: string;
    /** 1-based line number for the gutter, or 0 for synthetic header lines. */
    lineNum: number;
    /** Indent depth (4-space per level). */
    depth: number;
    /** Pre-tokenized line content (whitespace preserved). */
    tokens: TokenSpan[];
    /** Optional nested action path, e.g. `4.ifActions.2`. */
    actionPath?: string;
    /** Optional file-level background (diagnostics: errors/warnings). */
    staticBackground?: number;
    /** Optional file-level foreground color override (parse errors). */
    staticForeground?: number;
    /** When true, this is a synthetic header/footer line — no gutter glyph. */
    isHeader?: boolean;
};

/**
 * Visual modifications applied to a `RenderableLine` at render time. A
 * `LineDecorator` returns one of these per line. Anything left undefined
 * falls back to the row's `staticBackground`/`staticForeground`/no overlay.
 */
export type LineDecorations = {
    /** Per-line diff state — drives gutter glyph + colour palette. */
    state?: DiffState;
    /** Override foreground color (else syntax-highlighted tokens render normally). */
    foregroundColor?: number;
    /** Override background colour. */
    background?: number;
    /** Per-row detail string rendered right-aligned. */
    detail?: string;
    /** Per-token underline set (matches token.fieldProp). */
    underlinedFields?: { [prop: string]: true };
    /**
     * Per-line foreground alpha factor 0..1 — used for the gray→vibrant
     * fade-in. 1 = full opacity (default), 0 = same color but invisible.
     */
    alpha?: number;
    /** When true, drop a blue `▶` triangle in the focus gutter. */
    isFocused?: boolean;
    /**
     * Synthetic lines inserted ABOVE this row in the rendered output.
     * Used for "before / after" rendering of edit ops — the observed
     * action is rendered above the desired one.
     */
    extraLinesBefore?: { line: RenderableLine; decorations: LineDecorations }[];
    /**
     * Role of this line within a tall `[` bracket spanning multi-line
     * focus. "top" draws the opening corner, "middle" the vertical bar,
     * "bottom" the closing corner.
     */
    bracketRole?: "top" | "middle" | "bottom";
    /**
     * When set, tokens whose `fieldProp` matches this string get a blue
     * background tint — used for the field-level focus box during an
     * edit op. The decorator returns this for the line being actively
     * edited so the visual narrows from "this line" to "this field".
     */
    focusedFieldProp?: string;
    /**
     * When true, render the line body in italic. Used for ghost
     * (future-edit) and placeholder (unhydrated nested) lines so they
     * stand apart from the real source. Implementation: lineRow renders
     * the line as a single `§o<text>§r` Text element instead of
     * per-token Texts (italic per-token would let tokens drift apart).
     */
    italic?: boolean;
    /**
     * When true, suppress the line-number column entirely. Used for
     * ghost / placeholder lines. The column still reserves its width so
     * gutter alignment is preserved across rows.
     */
    hideLineNum?: boolean;
    /**
     * Background tint applied ONLY to the cursor (▶) column for this
     * line. Used by the apply-phase focus indicator: a tall blue box
     * runs through the cursor column for every line in the focus range
     * (single line OR multi-line bracket span), without overriding the
     * row's own diff-state tint (red/green/gold). For the read+hydrate
     * phase the decorator uses `background` (full row) instead.
     */
    cursorColumnBackground?: number;
};

/**
 * Bracket span computed by a decorator. Drawn as a tall `[` in the focus
 * gutter spanning from `topLineId` to `bottomLineId`.
 */
export type FocusBracket = {
    topLineId: string;
    bottomLineId: string;
};

/**
 * Field-level focus box. The decorator returns this when the importer is
 * editing a specific field within a line, so CodeView can overlay a 1-px
 * blue border around the matching token's rect.
 */
export type FocusFieldBox = {
    lineId: string;
    fieldProp: string;
};

/**
 * The pluggable decoration layer. `LineDecorator` instances are
 * memoised per file path; `diffDecorator` produces the View-tab look,
 * `progressDecorator` adds animations + focus overlays for the Import tab.
 */
export type LineDecorator = {
    /** Per-line look. Called once per visible line per frame. */
    decorateLine(line: RenderableLine): LineDecorations;
    /**
     * The line id the importer is currently working on, or null. CodeView
     * uses this to drive the Spotify-lyrics scroll behaviour.
     */
    focusedLineId(): string | null;
    /** Optional multi-line bracket range (e.g. CONDITIONAL.ifActions in flight). */
    focusBracket?(): FocusBracket | null;
    /** Optional field-level focus box. */
    focusFieldBox?(): FocusFieldBox | null;
};
