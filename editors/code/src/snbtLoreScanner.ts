import * as htsw from "htsw";

export interface LoreStringMatch {
    start: number;
    end: number;
    value: string;
    quote: '"' | "'";
}

export function findLoreStrings(text: string): LoreStringMatch[] {
    const tokens = collectTokens(text);
    return walk(tokens);
}

function collectTokens(text: string): TokenWithQuote[] {
    const lexer = new htsw.nbt.Lexer(text);
    const out: TokenWithQuote[] = [];
    while (true) {
        const tok = lexer.advanceToken();
        if (tok.kind === "eof") return out;
        if (tok.kind === "unknown") return out;

        if (tok.kind === "str") {
            const quoteChar = text[tok.span.start];
            const quote: '"' | "'" = quoteChar === "'" ? "'" : '"';
            out.push({ ...tok, quote });
        } else {
            out.push(tok);
        }
    }
}

type LexerToken = ReturnType<htsw.nbt.Lexer["advanceToken"]>;
type TokenWithQuote =
    | (Extract<LexerToken, { kind: "str" }> & { quote: '"' | "'" })
    | Exclude<LexerToken, { kind: "str" }>;

function walk(tokens: TokenWithQuote[]): LoreStringMatch[] {
    const result: LoreStringMatch[] = [];
    let pos = 0;

    function peek(offset = 0): TokenWithQuote | undefined {
        return tokens[pos + offset];
    }
    function consume(): TokenWithQuote | undefined {
        return tokens[pos++];
    }
    function isOpen(t: TokenWithQuote | undefined, delim: "brace" | "bracket"): boolean {
        return t?.kind === "open_delim" && t.delim === delim;
    }
    function isClose(t: TokenWithQuote | undefined, delim: "brace" | "bracket"): boolean {
        return t?.kind === "close_delim" && t.delim === delim;
    }

    function parseValue(insideLoreList: boolean): boolean {
        const tok = peek();
        if (!tok) return false;

        if (isOpen(tok, "brace")) {
            consume();
            return parseCompound();
        }
        if (isOpen(tok, "bracket")) {
            consume();
            return parseList(false);
        }
        if (tok.kind === "str") {
            if (insideLoreList) {
                result.push({
                    start: tok.span.start,
                    end: tok.span.end,
                    value: tok.value,
                    quote: tok.quote,
                });
            }
            consume();
            return true;
        }
        if (tok.kind === "bare") {
            consume();
            return true;
        }
        return false;
    }

    function parseCompound(): boolean {
        while (true) {
            const t = peek();
            if (!t) return false;
            if (isClose(t, "brace")) { consume(); return true; }

            if (t.kind !== "str" && t.kind !== "bare") return false;
            const key = t.value;
            consume();

            if (peek()?.kind !== "colon") return false;
            consume();

            const valStart = peek();
            if (!valStart) return false;
            if (isOpen(valStart, "bracket")) {
                consume();
                if (!parseList(key === "Lore")) return false;
            } else {
                if (!parseValue(false)) return false;
            }

            const after = peek();
            if (!after) return false;
            if (after.kind === "comma") { consume(); continue; }
            if (isClose(after, "brace")) { consume(); return true; }
            return false;
        }
    }

    function parseList(isLore: boolean): boolean {
        const first = peek();
        if (!first) return false;
        if (isClose(first, "bracket")) { consume(); return true; }

        if (first.kind === "bare" && peek(1)?.kind === "semicolon") {
            consume();
            consume();
            while (true) {
                const t = peek();
                if (!t) return false;
                if (isClose(t, "bracket")) { consume(); return true; }
                if (t.kind === "comma") { consume(); continue; }
                if (!parseValue(false)) return false;
            }
        }

        while (true) {
            const t = peek();
            if (!t) return false;
            if (isClose(t, "bracket")) { consume(); return true; }
            if (t.kind === "comma") { consume(); continue; }
            if (!parseValue(isLore)) return false;
        }
    }

    parseValue(false);
    return result;
}
