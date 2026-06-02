/// <reference types="../../../CTAutocomplete" />

/**
 * Shared text/code-view data types. The code-view module turns a file path
 * into decorated lines rendered inside a Scroll. Both the View tab (static
 * diff colors) and the Import tab (animated freshness + focus cursor)
 * compose against the same primitives via `LineDecorator`.
 */

import type { SyntaxToken } from "../right-panel/syntax";
import type { DiffState } from "../state/diffPalette";

export type TokenSpan = SyntaxToken & {
    fieldProp?: string;
    spanId?: string;
    underline?: boolean;
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
};

export type LineDecorations = {
    state?: DiffState;
    foregroundColor?: number;
    background?: number;
    detail?: string;
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
