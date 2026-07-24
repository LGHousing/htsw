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
import type { ActionTreePath } from "../../housingSync/actionPath";

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
    actionPath?: ActionTreePath;
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
    /**
     * Reserve the focus (▶) and/or diff-state (+/~/-) gutter columns for the
     * whole view, independent of whether any line currently carries that
     * decoration. Without this the columns mount and unmount as decorations
     * come and go, shifting every row sideways mid-task. A gutter is still
     * shown when line content needs it even if the reservation says false.
     * Omit to derive both purely from line content.
     */
    gutterVisibility?(): { focus: boolean; state: boolean };
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
