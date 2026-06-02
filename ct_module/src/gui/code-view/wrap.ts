/// <reference types="../../../CTAutocomplete" />

import { chatWidth } from "../../utils/helpers";
import type { TokenSpan } from "./lineTypes";

const MIN_WRAP_W = 6;

function stringWidth(text: string): number {
    return chatWidth(text, false);
}

function cloneToken(token: TokenSpan, text: string): TokenSpan {
    return {
        text,
        color: token.color,
        fieldProp: token.fieldProp,
        spanId: token.spanId,
        underline: token.underline,
    };
}

function lastWhitespaceBreak(text: string, maxWidthPx: number): number {
    let last = -1;
    for (let i = 1; i <= text.length; i++) {
        const ch = text.charAt(i - 1);
        if (ch === " " || ch === "\t") {
            if (stringWidth(text.substring(0, i)) <= maxWidthPx) last = i;
            else break;
        }
    }
    return last;
}

function longestPrefixThatFits(text: string, maxWidthPx: number): number {
    let best = 1;
    for (let i = 1; i <= text.length; i++) {
        if (stringWidth(text.substring(0, i)) > maxWidthPx) break;
        best = i;
    }
    return best;
}

function splitToken(token: TokenSpan, maxWidthPx: number): TokenSpan[] {
    const out: TokenSpan[] = [];
    let rest = token.text;
    while (rest.length > 0) {
        if (stringWidth(rest) <= maxWidthPx) {
            out.push(cloneToken(token, rest));
            break;
        }
        let cut = lastWhitespaceBreak(rest, maxWidthPx);
        if (cut <= 0) cut = longestPrefixThatFits(rest, maxWidthPx);
        out.push(cloneToken(token, rest.substring(0, cut)));
        rest = rest.substring(cut);
        while (rest.length > 0 && rest.charAt(0) === " ") rest = rest.substring(1);
    }
    return out;
}

export function wrapTokensIntoVisualRows(
    tokens: readonly TokenSpan[],
    maxWidthPx: number
): TokenSpan[][] {
    const limit = Math.max(MIN_WRAP_W, Math.floor(maxWidthPx));
    if (tokens.length === 0) return [[]];

    const rows: TokenSpan[][] = [];
    let row: TokenSpan[] = [];
    let rowWidth = 0;

    function pushRow(): void {
        rows.push(row);
        row = [];
        rowWidth = 0;
    }

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.text.length === 0) continue;

        const tokenWidth = stringWidth(token.text);
        if (rowWidth + tokenWidth <= limit) {
            row.push(token);
            rowWidth += tokenWidth;
            continue;
        }

        if (row.length > 0) pushRow();

        if (tokenWidth <= limit) {
            row.push(token);
            rowWidth = tokenWidth;
            continue;
        }

        const pieces = splitToken(token, limit);
        for (let j = 0; j < pieces.length; j++) {
            if (row.length > 0) pushRow();
            row.push(pieces[j]);
            rowWidth = stringWidth(pieces[j].text);
        }
    }

    if (row.length > 0 || rows.length === 0) rows.push(row);
    return rows;
}

export function joinTokenText(tokens: readonly TokenSpan[]): string {
    let out = "";
    for (let i = 0; i < tokens.length; i++) out += tokens[i].text;
    return out;
}
