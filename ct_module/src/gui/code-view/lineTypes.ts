/// <reference types="../../../CTAutocomplete" />

/**
 * Shared text/code-view data types. The code-view module turns a file path
 * into decorated lines rendered inside a Scroll. Both the View tab (static
 * diff colors) and the Import tab (animated freshness + focus cursor)
 * compose against the same primitives via `LineDecorator`.
 */

import type { SyntaxToken } from "../right-panel/syntax";
import type { DiffState } from "./diffPalette";
import type { Diagnostic, ImportablesParseResult } from "htsw";

export type TokenSpan = SyntaxToken & {
    fieldProp?: string;
    underlineColor?: number;
    linkTarget?: string;
    /**
     * Column where this token's text begins in its source line. Stamped by
     * `wrapTokensIntoVisualRows` so text selection can map a click on a wrapped
     * visual row back to a position in the unwrapped source.
     */
    srcStart?: number;
};

/**
 * The selected source-column range on a single logical line. `continuesRight`
 * is true when the selection extends past this line (so the highlight should
 * reach the right margin to show the trailing newline is included).
 */
export type LineSelection = {
    start: number;
    end: number;
    continuesRight: boolean;
};

export type FieldSpan = {
    prop: string;
    start: number;
    end: number;
};

export type RenderableLine = {
    id: string;
    lineNum: number;
    depth: number;
    tokens: TokenSpan[];
    actionPath?: string;
    staticBackground?: number;
    staticForeground?: number;
    isHeader?: boolean;
    diagnostics?: readonly Diagnostic[];
    diagnosticParse?: ImportablesParseResult;
};

export type LineDecorations = {
    state?: DiffState;
    foregroundColor?: number;
    background?: number;
    detail?: string;
    /**
     * Extra hover-card lines (&-formatted) for this row, merged after any
     * diagnostics. Lazy — only invoked while the row is actually hovered.
     */
    hoverLines?: () => readonly string[] | null;
    alpha?: number;
    isFocused?: boolean;
    extraLinesBefore?: { line: RenderableLine; decorations: LineDecorations }[];
    italic?: boolean;
    hideLineNum?: boolean;
    cursorColumnBackground?: number;
};

export type LineDecorator = {
    decorateLine(line: RenderableLine): LineDecorations;
    focusedLineId(): string | null;
    extraLinesAtEnd?(): { line: RenderableLine; decorations: LineDecorations }[];
    /**
     * Identity of everything `decorateLine` reads. The code view caches its
     * whole-file decoration pass and reuses it while (lines, this key,
     * viewport width) are unchanged — so scroll frames skip re-decorating
     * every line. The key must therefore change whenever any state that can
     * alter any line's decorations changes. Return null to opt out of
     * caching (the pass then reruns every rebuilt frame).
     */
    modelKey(): string | null;
};
