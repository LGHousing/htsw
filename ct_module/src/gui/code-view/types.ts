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
    /**
     * Per-line foreground alpha factor 0..1 — used for fades. 1 = full
     * opacity (default), 0 = invisible. The morph preview doesn't drive
     * this currently; reserved for future tween-style transitions.
     */
    alpha?: number;
    /** When true, drop a blue `▶` triangle in the focus gutter. */
    isFocused?: boolean;
    /**
     * Synthetic lines inserted ABOVE this row in the rendered output.
     * Used for "before / after" rendering of edit ops.
     */
    extraLinesBefore?: { line: RenderableLine; decorations: LineDecorations }[];
    /**
     * When true, render the line body in italic. Used for ghost
     * (future-edit) and placeholder (unhydrated nested) lines so they
     * stand apart from the real source. lineRow renders the line as a
     * single `§o<text>§r` Text element instead of per-token Texts so
     * italics don't let tokens drift apart.
     */
    italic?: boolean;
    /**
     * When true, suppress the line-number column entirely. Used for
     * ghost / placeholder lines. The column still reserves its width so
     * gutter alignment is preserved across rows.
     */
    hideLineNum?: boolean;
    /**
     * Background tint applied ONLY to the cursor (▶) column. Used by
     * the apply-phase focus indicator: a tall blue box runs through the
     * cursor column without overriding the row's own diff-state tint
     * (red/green/gold). The reading phase uses `background` (full row)
     * instead.
     */
    cursorColumnBackground?: number;
};

/**
 * The pluggable decoration layer. `LineDecorator` instances are built
 * fresh per frame in `CodeView`; `diffDecorator` produces the View-tab
 * look, `progressDecorator` adds animations + focus overlays for the
 * Import tab.
 */
export type LineDecorator = {
    /** Per-line look. Called once per visible line per frame. */
    decorateLine(line: RenderableLine): LineDecorations;
    /**
     * The line id the importer is currently working on, or null. CodeView
     * uses this to drive the Spotify-lyrics scroll behaviour.
     */
    focusedLineId(): string | null;
};
