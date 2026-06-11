/// <reference types="../../../CTAutocomplete" />

/**
 * Shared text/code-view data types. The code-view module turns a file path
 * into decorated lines rendered inside a Scroll. Both the View tab (static
 * diff colors) and the Import tab (animated freshness + focus cursor)
 * compose against the same primitives via `LineDecorator`.
 */

import type { SyntaxToken } from "../right-panel/syntax";
import type { DiffState } from "./diffPalette";
import type { Diagnostic } from "htsw";

export type TokenSpan = SyntaxToken & {
    fieldProp?: string;
    underlineColor?: number;
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
};
