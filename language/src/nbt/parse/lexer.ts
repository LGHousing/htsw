import { Span } from "../../span";
import { token, type Token } from "./token";

export class Lexer {
    src: string;
    pos: number;
    posOffset: number;

    constructor(src: string, posOffset: number = 0) {
        this.src = src;
        this.pos = 0;
        this.posOffset = posOffset;
    }

    advanceToken(): Token {
        while (this.hasNext() && /\s/.test(this.peek())) {
            this.next();
        }

        if (!this.hasNext()) {
            return token("eof", new Span(this.posWithOffset, this.posWithOffset));
        }

        const lo = this.posWithOffset;
        const c = this.next();

        if (c === "{") return token("open_delim", Span.single(lo), { delim: "brace" });
        if (c === "}") return token("close_delim", Span.single(lo), { delim: "brace" });
        if (c === "[") return token("open_delim", Span.single(lo), { delim: "bracket" });
        if (c === "]") return token("close_delim", Span.single(lo), { delim: "bracket" });
        if (c === ":") return token("colon", Span.single(lo));
        if (c === ";") return token("semicolon", Span.single(lo));
        if (c === ",") return token("comma", Span.single(lo));

        if (c === '"' || c === "'") {
            const quote = c;
            let value = "";
            let escaped = false;

            while (this.hasNext()) {
                const ch = this.next();
                if (escaped) {
                    value += decodeEscape(ch);
                    escaped = false;
                    continue;
                }

                if (ch === "\\") {
                    escaped = true;
                    continue;
                }

                if (ch === quote) {
                    return token("str", new Span(lo, this.posWithOffset), { value });
                }

                value += ch;
            }

            // Unterminated strings are still returned as string tokens so the parser
            // can produce one consistent "expected separator/end" error.
            return token("str", new Span(lo, this.posWithOffset), { value });
        }

        if (isBareStart(c)) {
            let value = c;
            while (this.hasNext() && isBareChar(this.peek())) {
                value += this.next();
            }
            return token("bare", new Span(lo, this.posWithOffset), { value });
        }

        return token("unknown", Span.single(lo), { value: c });
    }

    get posWithOffset() {
        return this.pos + this.posOffset;
    }

    hasNext(): boolean {
        return this.pos < this.src.length;
    }

    next(): string {
        return this.src.charAt(this.pos++);
    }

    peek(skip?: number): string {
        return this.src.charAt(this.pos + (skip ?? 0));
    }
}

function isBareStart(ch: string): boolean {
    return /[A-Za-z0-9+\-.]/.test(ch);
}

function isBareChar(ch: string): boolean {
    return /[A-Za-z0-9+\-._]/.test(ch);
}

function decodeEscape(ch: string): string {
    if (ch === "n") return "\n";
    if (ch === "r") return "\r";
    if (ch === "t") return "\t";
    return ch;
}
