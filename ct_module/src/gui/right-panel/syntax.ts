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
    ACCENT_DANGER,
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
const COLOR_COMMENT = 0xff707070 | 0;
const COLOR_JSON_KEY = ACCENT_DANGER;
const COLOR_JSON_LITERAL = ACCENT_INFO;

const SECTION = "§";
// Codes are shown with `&` (the HTSL-native prefix) instead of `§`: the literal
// § would be eaten by MC's font renderer (it pairs § with its code char) and is
// reported as width −1, whereas `&` is an ordinary glyph we fully control.
const DISPLAY_SECTION = "&";

// Minecraft §-color codes → ARGB. Matches the exact palette the VS Code SNBT
// grammar paints (editors/code/package.json) so item text reads the same in
// both editors. Style codes (k–o) and reset (r) aren't here — they don't set a
// color.
const MC_FORMAT_COLOR: { [code: string]: number } = {
    "0": 0xff000000 | 0,
    "1": 0xff0000aa | 0,
    "2": 0xff00aa00 | 0,
    "3": 0xff00aaaa | 0,
    "4": 0xffaa0000 | 0,
    "5": 0xffaa00aa | 0,
    "6": 0xffffaa00 | 0,
    "7": 0xffaaaaaa | 0,
    "8": 0xff555555 | 0,
    "9": 0xff5555ff | 0,
    a: 0xff55ff55 | 0,
    b: 0xff55ffff | 0,
    c: 0xffff5555 | 0,
    d: 0xffff55ff | 0,
    e: 0xffffff55 | 0,
    f: 0xffffffff | 0,
};

export type SyntaxToken = { text: string; color: number };

// Nearest chat color code per token color, for surfaces that render plain
// &-coded strings (hover cards) instead of Text elements.
const CHAT_CODE_BY_COLOR = new Map<number, string>([
    [COLOR_DEFAULT, "&f"],
    [COLOR_KEYWORD, "&b"],
    [COLOR_TYPE, "&d"],
    [COLOR_NUMBER, "&6"],
    [COLOR_STRING, "&a"],
    [COLOR_VAR_REF, "&3"],
    [COLOR_OPERATOR, "&7"],
    [COLOR_COMMENT, "&8"],
]);

export function htslLineToChatString(line: string): string {
    const tokens = tokenizeHtsl(line);
    let out = "";
    let lastCode = "";
    for (const token of tokens) {
        const code = CHAT_CODE_BY_COLOR.get(token.color) ?? "&f";
        if (code !== lastCode) {
            out += code;
            lastCode = code;
        }
        out += token.text;
    }
    return out;
}

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
    actionBar: true,
    applyLayout: true,
    applyPotion: true,
    balanceTeam: true,
    blockType: true,
    cancelEvent: true,
    canPvp: true,
    changeHealth: true,
    changePlayerGroup: true,
    changeVelocity: true,
    clearEffects: true,
    closeMenu: true,
    compassTarget: true,
    consumeItem: true,
    damageAmount: true,
    damageCause: true,
    displayMenu: true,
    displayNametag: true,
    doingParkour: true,
    dropItem: true,
    enchant: true,
    if: true,
    else: true,
    elseif: true,
    exit: true,
    failParkour: true,
    fishingEnv: true,
    fullHeal: true,
    function: true,
    gamemode: true,
    giveItem: true,
    hasGroup: true,
    hasItem: true,
    hasPermission: true,
    hasPotion: true,
    hasTeam: true,
    health: true,
    hunger: true,
    hungerLevel: true,
    inRegion: true,
    isFlying: true,
    isItem: true,
    isSneaking: true,
    kill: true,
    launchTarget: true,
    lobby: true,
    maxHealth: true,
    parkCheck: true,
    placeholder: true,
    playerTime: true,
    playerWeather: true,
    portal: true,
    random: true,
    removeItem: true,
    resetInventory: true,
    return: true,
    chat: true,
    goto: true,
    pause: true,
    sound: true,
    setTeam: true,
    title: true,
    tp: true,
    xpLevel: true,
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
    true: true,
    false: true,
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

        // Line comment — consume to end of line. Matches the htsw lexer
        // (`//` introduces a line comment, `///` a doc comment; either
        // way the rest of the line is comment-colored in the view).
        if (c === "/" && i + 1 < n && line.charAt(i + 1) === "/") {
            tokens.push({ text: line.substring(i), color: COLOR_COMMENT });
            i = n;
            continue;
        }

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

function skipWhitespace(line: string, i: number): number {
    while (i < line.length) {
        const c = line.charAt(i);
        if (c !== " " && c !== "\t") break;
        i++;
    }
    return i;
}

function readQuotedString(line: string, i: number, quote: string = '"'): number {
    let j = i + 1;
    while (j < line.length) {
        const c = line.charAt(j);
        if (c === "\\" && j + 1 < line.length) {
            j += 2;
            continue;
        }
        if (c === quote) return j + 1;
        j++;
    }
    return j;
}

export function tokenizeJson(line: string): SyntaxToken[] {
    const tokens: SyntaxToken[] = [];
    let i = 0;
    const n = line.length;

    while (i < n) {
        const c = line.charAt(i);

        if (c === "/" && i + 1 < n && line.charAt(i + 1) === "/") {
            tokens.push({ text: line.substring(i), color: COLOR_COMMENT });
            break;
        }

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

        if (c === '"') {
            const j = readQuotedString(line, i);
            const after = skipWhitespace(line, j);
            const color = after < n && line.charAt(after) === ":" ? COLOR_JSON_KEY : COLOR_STRING;
            tokens.push({ text: line.substring(i, j), color });
            i = j;
            continue;
        }

        if (
            c === "{"
            || c === "}"
            || c === "["
            || c === "]"
            || c === ":"
            || c === ","
        ) {
            tokens.push({ text: c, color: COLOR_PUNCT });
            i++;
            continue;
        }

        if (c === "-" || isDigit(c)) {
            let j = c === "-" ? i + 1 : i;
            while (j < n && isDigit(line.charAt(j))) j++;
            if (j < n && line.charAt(j) === ".") {
                j++;
                while (j < n && isDigit(line.charAt(j))) j++;
            }
            if (j < n && (line.charAt(j) === "e" || line.charAt(j) === "E")) {
                let k = j + 1;
                if (k < n && (line.charAt(k) === "+" || line.charAt(k) === "-")) k++;
                let hasExpDigit = false;
                while (k < n && isDigit(line.charAt(k))) {
                    hasExpDigit = true;
                    k++;
                }
                if (hasExpDigit) j = k;
            }
            tokens.push({ text: line.substring(i, j), color: COLOR_NUMBER });
            i = j;
            continue;
        }

        if (isIdentStart(c)) {
            let j = i + 1;
            while (j < n && isIdentCont(line.charAt(j))) j++;
            const text = line.substring(i, j);
            const color =
                text === "true" || text === "false" || text === "null"
                    ? COLOR_JSON_LITERAL
                    : COLOR_DEFAULT;
            tokens.push({ text, color });
            i = j;
            continue;
        }

        tokens.push({ text: c, color: COLOR_DEFAULT });
        i++;
    }

    return tokens;
}

// SNBT keys are unquoted barewords like `id` / `Count` / `display`; the chars
// allowed are letters, digits, and `+ - . _`.
function isSnbtUnquoted(c: string): boolean {
    return (
        (c >= "a" && c <= "z")
        || (c >= "A" && c <= "Z")
        || (c >= "0" && c <= "9")
        || c === "_"
        || c === "+"
        || c === "."
        || c === "-"
    );
}

// Lift a format color that would be unreadable on the dark code-view panel
// (COLOR_PANEL, luminance ~30). Bright codes pass through exactly as Minecraft
// defines them; only the dark ones (§0/§4/§8…) are scaled up to a legible
// luminance, preserving hue where possible.
function legibleOnDark(color: number): number {
    const r = (color >>> 16) & 0xff;
    const g = (color >>> 8) & 0xff;
    const b = color & 0xff;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const MIN_LUM = 120;
    if (lum >= MIN_LUM) return color;
    const alpha = color & (0xff000000 | 0);
    if (lum <= 0) {
        return (alpha | (MIN_LUM << 16) | (MIN_LUM << 8) | MIN_LUM) | 0;
    }
    const k = MIN_LUM / lum;
    const nr = Math.min(255, Math.round(r * k));
    const ng = Math.min(255, Math.round(g * k));
    const nb = Math.min(255, Math.round(b * k));
    return (alpha | (nr << 16) | (ng << 8) | nb) | 0;
}

// Split a quoted SNBT string *value* (e.g. `"§6Starter Wand"`) into colored
// runs, recoloring at each §-code by its (legibility-lifted) Minecraft color and
// showing the code with `&`. Length is preserved (`&` is one char like `§`) so
// the tokens still line up with the source columns for diagnostic spans.
function snbtValueStringTokens(raw: string, quote: string): SyntaxToken[] {
    const out: SyntaxToken[] = [];
    const hasClose = raw.length >= 2 && raw.charAt(raw.length - 1) === quote;
    const end = hasClose ? raw.length - 1 : raw.length;

    let color = COLOR_STRING;
    let segStart = 0;
    let segIsCode = false;
    let i = 0;

    function pushSeg(segEnd: number): void {
        if (segEnd <= segStart) return;
        let text = raw.substring(segStart, segEnd);
        if (segIsCode) text = DISPLAY_SECTION + text.substring(1);
        out.push({ text, color });
    }

    while (i < end) {
        if (raw.charAt(i) === SECTION && i + 1 < end) {
            pushSeg(i);
            const code = raw.charAt(i + 1).toLowerCase();
            const mc = MC_FORMAT_COLOR[code];
            if (mc !== undefined) color = legibleOnDark(mc);
            else if (code === "r") color = COLOR_STRING;
            segStart = i;
            segIsCode = true;
            i += 2;
            continue;
        }
        i++;
    }
    pushSeg(end);
    if (hasClose) out.push({ text: quote, color: COLOR_STRING });
    return out;
}

/**
 * Tokenize a single SNBT source line. Like {@link tokenizeJson} but aware of
 * unquoted keys, numeric type suffixes (`1b` / `1.0f`), single-quoted strings,
 * and the §-format codes embedded in item display strings. Always splits the
 * input fully — `tokens.map(t => t.text).join("")` reconstructs the line.
 */
export function tokenizeSnbt(line: string): SyntaxToken[] {
    const tokens: SyntaxToken[] = [];
    let i = 0;
    const n = line.length;

    while (i < n) {
        const c = line.charAt(i);

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

        if (c === '"' || c === "'") {
            const j = readQuotedString(line, i, c);
            const after = skipWhitespace(line, j);
            if (after < n && line.charAt(after) === ":") {
                tokens.push({ text: line.substring(i, j), color: COLOR_JSON_KEY });
            } else {
                const parts = snbtValueStringTokens(line.substring(i, j), c);
                for (let k = 0; k < parts.length; k++) tokens.push(parts[k]);
            }
            i = j;
            continue;
        }

        if (
            c === "{"
            || c === "}"
            || c === "["
            || c === "]"
            || c === ":"
            || c === ";"
            || c === ","
        ) {
            tokens.push({ text: c, color: COLOR_PUNCT });
            i++;
            continue;
        }

        if (
            isDigit(c)
            || (c === "-" && i + 1 < n && (isDigit(line.charAt(i + 1)) || line.charAt(i + 1) === "."))
            || (c === "." && i + 1 < n && isDigit(line.charAt(i + 1)))
        ) {
            let j = c === "-" ? i + 1 : i;
            while (j < n && isDigit(line.charAt(j))) j++;
            if (j < n && line.charAt(j) === ".") {
                j++;
                while (j < n && isDigit(line.charAt(j))) j++;
            }
            if (j < n && (line.charAt(j) === "e" || line.charAt(j) === "E")) {
                let k = j + 1;
                if (k < n && (line.charAt(k) === "+" || line.charAt(k) === "-")) k++;
                let hasExpDigit = false;
                while (k < n && isDigit(line.charAt(k))) {
                    hasExpDigit = true;
                    k++;
                }
                if (hasExpDigit) j = k;
            }
            if (
                j < n
                && "bBsSiIlLfFdD".indexOf(line.charAt(j)) >= 0
                && (j + 1 >= n || !isSnbtUnquoted(line.charAt(j + 1)))
            ) {
                j++;
            }
            tokens.push({ text: line.substring(i, j), color: COLOR_NUMBER });
            i = j;
            continue;
        }

        if (isSnbtUnquoted(c)) {
            let j = i + 1;
            while (j < n && isSnbtUnquoted(line.charAt(j))) j++;
            const text = line.substring(i, j);
            const after = skipWhitespace(line, j);
            let color = COLOR_DEFAULT;
            if (after < n && line.charAt(after) === ":") color = COLOR_JSON_KEY;
            else if (text === "true" || text === "false") color = COLOR_JSON_LITERAL;
            tokens.push({ text, color });
            i = j;
            continue;
        }

        tokens.push({ text: c, color: COLOR_DEFAULT });
        i++;
    }

    return tokens;
}
