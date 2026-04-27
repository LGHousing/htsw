// Locates string-typed list elements that are direct children of a `Lore: [...]`
// list inside SNBT text. The plan called for using `htsw.nbt.parseSnbt` plus
// `gcx.spans.get(stringNode)` for lookups, but the SNBT parser at
// `language/src/nbt/parse/parser.ts` collapses lists down to raw values
// (`TagList.value.value: T[]`) and discards the per-element Tag references —
// so individual element spans are not recoverable from the parsed AST.
//
// Instead we run a tiny self-contained SNBT lexer + recursive-descent walker
// that records the source span of every string token whose immediate parent
// is a `Lore: [...]` list. This deliberately mirrors the SNBT lexer rules at
// `language/src/nbt/parse/lexer.ts` (same character classes for bare tokens,
// same string escape semantics with both `"..."` and `'...'`).

export interface LoreStringMatch {
    /** Source offset of the opening quote. */
    start: number;
    /** Source offset just after the closing quote. */
    end: number;
    /** Decoded string content (escapes processed). */
    value: string;
    /** The quote character used in the source. */
    quote: '"' | "'";
}

/**
 * Returns every string-typed element directly inside any `Lore: [...]` list in
 * the given SNBT source. Returns `[]` on lex/parse error — the caller should
 * treat that as "no actionable Lore strings found".
 */
export function findLoreStrings(text: string): LoreStringMatch[] {
    const tokens = tokenize(text);
    if (tokens === null) return [];
    return walk(tokens);
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type Tok =
    | { kind: "{"; start: number; end: number }
    | { kind: "}"; start: number; end: number }
    | { kind: "["; start: number; end: number }
    | { kind: "]"; start: number; end: number }
    | { kind: ":"; start: number; end: number }
    | { kind: ","; start: number; end: number }
    | { kind: ";"; start: number; end: number }
    | { kind: "string"; start: number; end: number; value: string; quote: '"' | "'" }
    | { kind: "bare"; start: number; end: number; value: string };

const BARE_CHAR = /[A-Za-z0-9+\-._]/;

function tokenize(text: string): Tok[] | null {
    const out: Tok[] = [];
    let i = 0;
    while (i < text.length) {
        const c = text[i];

        if (c === " " || c === "\t" || c === "\n" || c === "\r") {
            i++;
            continue;
        }

        if (c === "{" || c === "}" || c === "[" || c === "]" || c === ":" || c === "," || c === ";") {
            out.push({ kind: c, start: i, end: i + 1 });
            i++;
            continue;
        }

        if (c === '"' || c === "'") {
            const quote = c;
            const start = i;
            i++;
            let value = "";
            let escaped = false;
            let closed = false;
            while (i < text.length) {
                const ch = text[i];
                if (escaped) {
                    // Match the SNBT lexer's escape semantics:
                    // \n → newline, \r → carriage return, \t → tab,
                    // anything else → the literal char.
                    if (ch === "n") value += "\n";
                    else if (ch === "r") value += "\r";
                    else if (ch === "t") value += "\t";
                    else value += ch;
                    escaped = false;
                    i++;
                    continue;
                }
                if (ch === "\\") {
                    escaped = true;
                    i++;
                    continue;
                }
                if (ch === quote) {
                    i++;
                    closed = true;
                    break;
                }
                value += ch;
                i++;
            }
            if (!closed) return null;
            out.push({ kind: "string", start, end: i, value, quote });
            continue;
        }

        if (BARE_CHAR.test(c)) {
            const start = i;
            let value = "";
            while (i < text.length && BARE_CHAR.test(text[i])) {
                value += text[i];
                i++;
            }
            out.push({ kind: "bare", start, end: i, value });
            continue;
        }

        // Unrecognized character — give up cleanly. We return [] from the
        // public entry point so the code-action provider just won't offer
        // anything; that's the right behaviour for a malformed document.
        return null;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

function walk(tokens: Tok[]): LoreStringMatch[] {
    const result: LoreStringMatch[] = [];
    let pos = 0;

    function peek(offset = 0): Tok | undefined {
        return tokens[pos + offset];
    }
    function consume(): Tok | undefined {
        return tokens[pos++];
    }

    function parseValue(insideLoreList: boolean): boolean {
        const tok = peek();
        if (!tok) return false;

        switch (tok.kind) {
            case "{":
                consume();
                return parseCompound();
            case "[":
                consume();
                return parseList(false); // a fresh list is never itself a Lore container
            case "string":
                if (insideLoreList) {
                    result.push({
                        start: tok.start,
                        end: tok.end,
                        value: tok.value,
                        quote: tok.quote,
                    });
                }
                consume();
                return true;
            case "bare":
                consume();
                return true;
            default:
                return false;
        }
    }

    function parseCompound(): boolean {
        // Caller has already consumed '{'.
        while (true) {
            const t = peek();
            if (!t) return false;
            if (t.kind === "}") { consume(); return true; }

            if (t.kind !== "string" && t.kind !== "bare") return false;
            const key = t.value;
            consume();

            if (peek()?.kind !== ":") return false;
            consume();

            // Value position. If the value is a list, decide here whether it's
            // the magic `Lore` list — that's the only place isLore can become true.
            const valStart = peek();
            if (!valStart) return false;
            if (valStart.kind === "[") {
                consume();
                if (!parseList(key === "Lore")) return false;
            } else {
                if (!parseValue(false)) return false;
            }

            const after = peek();
            if (!after) return false;
            if (after.kind === ",") { consume(); continue; }
            if (after.kind === "}") { consume(); return true; }
            return false;
        }
    }

    function parseList(isLore: boolean): boolean {
        // Caller has already consumed '['.
        const first = peek();
        if (!first) return false;
        if (first.kind === "]") { consume(); return true; }

        // Typed-array prefix: bare followed by ';' (e.g. `[B; 1b, 2b]`).
        // Typed arrays only contain primitives, so isLore is irrelevant here.
        if (first.kind === "bare" && peek(1)?.kind === ";") {
            consume(); // bare
            consume(); // ;
            while (true) {
                const t = peek();
                if (!t) return false;
                if (t.kind === "]") { consume(); return true; }
                if (t.kind === ",") { consume(); continue; }
                if (!parseValue(false)) return false;
            }
        }

        while (true) {
            const t = peek();
            if (!t) return false;
            if (t.kind === "]") { consume(); return true; }
            if (t.kind === ",") { consume(); continue; }
            if (!parseValue(isLore)) return false;
        }
    }

    parseValue(false);
    return result;
}
