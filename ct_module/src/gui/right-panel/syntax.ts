/// <reference types="../../../CTAutocomplete" />

// Per-line HTSL tokenizer used by the right-panel source view (and by the
// live-importer, which re-uses `htslDiffLines`). The output is a flat list
// of `{ text, color }` segments that the renderer lays out as a Row of
// `Text` elements — concatenating the segment widths reproduces the original
// line, so we never need to slice a tokenized line later.
//
// HTSL is small and the rendered lines are short, so we keep this
// hand-written: cheaper and more readable than dragging in a full grammar.

import {
    ACCENT_INFO,
    ACCENT_ORANGE,
    ACCENT_PURPLE,
    ACCENT_SUCCESS,
    ACCENT_TEAL,
    COLOR_TEXT_DIM,
} from "../lib/theme";

const COLOR_DEFAULT = 0xffe5e5e5 | 0;
const COLOR_KEYWORD = ACCENT_INFO;
const COLOR_TYPE = ACCENT_PURPLE;
const COLOR_NUMBER = ACCENT_ORANGE;
const COLOR_STRING = ACCENT_SUCCESS;
const COLOR_VAR_REF = ACCENT_TEAL;
const COLOR_OPERATOR = COLOR_TEXT_DIM;
const COLOR_PUNCT = COLOR_TEXT_DIM;

export type SyntaxToken = { text: string; color: number };

// Storage-class style — these introduce variable bindings.
const TYPE_WORDS: { [k: string]: true } = {
    globalvar: true,
    var: true,
    teamvar: true,
    playervar: true,
    savedvar: true,
    statvar: true,
    serverstat: true,
};

// Control-flow / built-in actions.
const KEYWORDS: { [k: string]: true } = {
    if: true,
    else: true,
    elseif: true,
    exit: true,
    return: true,
    chat: true,
    goto: true,
    pause: true,
    cancel: true,
    apply: true,
    reset: true,
    set: true,
    give: true,
    take: true,
    None: true,
    True: true,
    False: true,
    and: true,
    or: true,
    not: true,
};

function isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
}

function isIdentStart(c: string): boolean {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

function isIdentCont(c: string): boolean {
    // Variable refs in HTSL look like `tm/bop` and `var.global/tm/t1`, so we
    // treat `/` and `.` as continuation chars. This means `//`-style comments
    // would be misread as identifiers — HTSL doesn't have line comments so
    // that's a non-issue, and our diff-engine `// (current label)` pseudo-
    // line is rendered with explicit color upstream and never tokenized.
    return isIdentStart(c) || isDigit(c) || c === "/" || c === ".";
}

/**
 * Tokenize a single HTSL source line. Always splits the input fully — i.e.
 * `tokens.map(t => t.text).join("")` reconstructs the input. Whitespace is
 * preserved as default-colored runs so the rendered Row keeps the original
 * spacing.
 */
export function tokenizeHtsl(line: string): SyntaxToken[] {
    const tokens: SyntaxToken[] = [];
    let i = 0;
    const n = line.length;

    while (i < n) {
        const c = line.charAt(i);

        // Whitespace run.
        if (c === " " || c === "\t") {
            let j = i + 1;
            while (j < n) {
                const cj = line.charAt(j);
                if (cj !== " " && cj !== "\t") break;
                j++;
            }
            tokens.push({ text: line.substring(i, j), color: COLOR_DEFAULT });
            i = j;
            continue;
        }

        // String literal — consume up to the next unescaped `"`. We don't
        // tokenize embedded `%var…%` refs inside strings (it would muddy the
        // colour scheme; the green string already reads as one unit).
        if (c === '"') {
            let j = i + 1;
            while (j < n) {
                const cj = line.charAt(j);
                if (cj === "\\" && j + 1 < n) {
                    j += 2;
                    continue;
                }
                if (cj === '"') {
                    j++;
                    break;
                }
                j++;
            }
            tokens.push({ text: line.substring(i, j), color: COLOR_STRING });
            i = j;
            continue;
        }

        // Variable reference outside a string: `%var.scope/key%`.
        if (c === "%") {
            let j = i + 1;
            while (j < n && line.charAt(j) !== "%") j++;
            if (j < n) j++; // consume closing %
            tokens.push({ text: line.substring(i, j), color: COLOR_VAR_REF });
            i = j;
            continue;
        }

        // Numeric literal (integer; decimal allowed mid-stream).
        if (isDigit(c)) {
            let j = i + 1;
            while (j < n && isDigit(line.charAt(j))) j++;
            if (j < n && line.charAt(j) === "." && j + 1 < n && isDigit(line.charAt(j + 1))) {
                j++;
                while (j < n && isDigit(line.charAt(j))) j++;
            }
            tokens.push({ text: line.substring(i, j), color: COLOR_NUMBER });
            i = j;
            continue;
        }

        // Identifier / keyword. Path-style names like `tm/bop` are one token.
        if (isIdentStart(c)) {
            let j = i + 1;
            while (j < n && isIdentCont(line.charAt(j))) j++;
            const text = line.substring(i, j);
            let color = COLOR_DEFAULT;
            if (TYPE_WORDS[text] === true) color = COLOR_TYPE;
            else if (KEYWORDS[text] === true) color = COLOR_KEYWORD;
            tokens.push({ text, color });
            i = j;
            continue;
        }

        // Comparison / assignment operators (one or two chars).
        if (c === "=" || c === "!" || c === "<" || c === ">") {
            let j = i + 1;
            if (j < n && line.charAt(j) === "=") j++;
            tokens.push({ text: line.substring(i, j), color: COLOR_OPERATOR });
            i = j;
            continue;
        }
        if (c === "+" || c === "-" || c === "*") {
            tokens.push({ text: c, color: COLOR_OPERATOR });
            i++;
            continue;
        }

        // Structural punctuation.
        if (c === "(" || c === ")" || c === "{" || c === "}" || c === "," || c === ";") {
            tokens.push({ text: c, color: COLOR_PUNCT });
            i++;
            continue;
        }

        // Anything else passes through with the default colour. Keeps us
        // robust to characters we haven't classified (e.g. UTF glyphs).
        tokens.push({ text: c, color: COLOR_DEFAULT });
        i++;
    }

    return tokens;
}
