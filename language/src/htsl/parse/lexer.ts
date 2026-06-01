import type { SourceFile } from "../../sourceMap";
import { Span } from "../../span";
import { token, type Token } from "./token";

// Char-code classifiers. Rhino has no JIT, so a regex `.test()` per character —
// and `charAt`'s per-char string allocation — are each ~2x slower than these.
function isInlineWs(k: number): boolean {
    // whitespace except newline (\n is its own token)
    return k === 32 || k === 9 || k === 13 || k === 12 || k === 11;
}
function isDigit(k: number): boolean {
    return k >= 48 && k <= 57;
}
function isDigitOrUnderscore(k: number): boolean {
    return (k >= 48 && k <= 57) || k === 95;
}
function isIdentStart(k: number): boolean {
    return (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || k === 95;
}
function isIdentChar(k: number): boolean {
    // matches /[a-zA-Z_/\-0-9.-]/: letters, digits, _ / - .
    return (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || (k >= 48 && k <= 57) ||
        k === 95 || k === 47 || k === 45 || k === 46;
}

export class Lexer {
    src: string;
    pos: number;
    posOffset: number;

    constructor(file: SourceFile) {
        this.src = file.src;
        this.pos = 0;
        this.posOffset = file.startPos;
    }

    advanceToken(): Token {
        // eat whitespace
        while (this.hasNext() && isInlineWs(this.src.charCodeAt(this.pos))) {
            this.pos++;
        }
        if (!this.hasNext())
            return token("eof", new Span(this.posWithOffset, this.posWithOffset));

        const lo = this.posWithOffset;
        const c = this.next();

        if (c === "/" && this.peek() === "/") {
            if (this.peek(1) == "/") {
                this.next();
                this.next();

                // parse doc comment
                const start = this.pos;

                do {
                    this.next();
                } while (this.hasNext() && this.peek() !== "\n");

                let value = this.src.substring(start, this.pos);
                if (value.endsWith("\r")) {
                    value = value.substring(0, value.length - 1);
                }
                
                return token("doc_comment", new Span(lo, this.posWithOffset), { value });
            }
            
            // eat line comment
            do {
                this.next();
            } while (this.hasNext() && this.peek() !== "\n");

            return this.advanceToken();
        }

        if (c === "/" && this.peek() === "*") {
            this.next();

            // eat block comment
            let depth = 1;
            while (this.hasNext()) {
                const c = this.next();
                if (c === "/" && this.peek() === "*") {
                    this.next();
                    depth++;
                } else if (c === "*" && this.peek() === "/") {
                    this.next();
                    depth--;
                    if (depth === 0) break;
                }
            }

            return this.advanceToken();
        }

        if (c === ",") return token("comma", Span.single(lo));
        if (c === "!") return token("exclamation", Span.single(lo));

        // binary operators
        if (c === "+") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "plus" });
            }
            return token("bin_op", Span.single(lo), { op: "plus" });
        }
        if (c === "-") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "minus" });
            }
            return token("bin_op", Span.single(lo), { op: "minus" });
        }
        if (c === "*") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "star" });
            }
            return token("bin_op", Span.single(lo), { op: "star" });
        }
        if (c === "/") {
            if (this.peek() === "/") this.next();
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, this.posWithOffset), { op: "slash" });
            }
            return token("bin_op", new Span(lo, this.posWithOffset), { op: "slash" });
        }
        if (c === "<" && this.peek(0) == "<") {
            this.next();
            if (this.peek(0) === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 3), { op: "lt_lt" });
            }
            return token("bin_op", Span.single(lo), { op: "lt_lt" });
        }
        if (c === ">" && this.peek(0) == ">") {
            this.next();
            if (this.peek(0) === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 3), { op: "gt_gt" });
            }
            return token("bin_op", Span.single(lo), { op: "gt_gt" });
        }
        if (c === "&") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "ampersand" });
            }
            return token("bin_op", Span.single(lo), { op: "ampersand" });
        }
        if (c === "|") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "vertical_bar" });
            }
            return token("bin_op", Span.single(lo), { op: "vertical_bar" });
        }
        if (c === "^") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "caret" });
            }
            return token("bin_op", Span.single(lo), { op: "caret" });
        }

        // comparison operators
        if (c === "=") {
            if (this.peek(0) === "=") {
                this.next();
                return token("cmp_op_eq", new Span(lo, lo + 2), { op: "equals" });
            }
            return token("cmp_op", Span.single(lo), { op: "equals" });
        }
        if (c === "<") {
            if (this.peek(0) === "=") {
                this.next();
                return token("cmp_op_eq", new Span(lo, lo + 2), { op: "less_than" });
            }
            return token("cmp_op", Span.single(lo), { op: "less_than" });
        }
        if (c === ">") {
            if (this.peek(0) === "=") {
                this.next();
                return token("cmp_op_eq", new Span(lo, lo + 2), { op: "greater_than" });
            }
            return token("cmp_op", Span.single(lo), { op: "greater_than" });
        }

        // delimiters
        if (c === "(") return token("open_delim", Span.single(lo), { delim: "parenthesis" });
        if (c === ")") return token("close_delim", Span.single(lo), { delim: "parenthesis" });
        if (c === "{") return token("open_delim", Span.single(lo), { delim: "brace" });
        if (c === "}") return token("close_delim", Span.single(lo), { delim: "brace" });
        if (c === "[") return token("open_delim", Span.single(lo), { delim: "bracket" });
        if (c === "]") return token("close_delim", Span.single(lo), { delim: "bracket" });

        // literals
        if (c === '"') {
            const parts: string[] = [];
            let escapeNext = false;
            while (this.hasNext()) {
                const c = this.next();
                if (!escapeNext && c === '"') break;
                if (!escapeNext && c === "\\") {
                    escapeNext = true;
                    continue;
                }
                escapeNext = false;
                parts.push(c);
            }

            return token("str", new Span(lo, this.posWithOffset), { value: parts.join("") });
        }

        if (c === "%") {
            const start = this.pos;
            while (this.hasNext() && this.peek() !== "%") this.next();
            const value = this.src.substring(start, this.pos);
            if (this.hasNext()) this.next();
            return token("placeholder", new Span(lo, this.posWithOffset), { value });
        }

        if (isDigit(c.charCodeAt(0))) {
            const start = this.pos - 1;
            while (this.hasNext() && isDigitOrUnderscore(this.src.charCodeAt(this.pos))) {
                this.pos++;
            }
            if (this.peek() === ".") {
                this.next();
                while (this.hasNext() && isDigitOrUnderscore(this.src.charCodeAt(this.pos))) {
                    this.pos++;
                }
                const value = this.src.substring(start, this.pos);
                return token("f64", new Span(lo, this.posWithOffset), { value });
            }
            const value = this.src.substring(start, this.pos);
            return token("i64", new Span(lo, this.posWithOffset), { value });
        }

        if (isIdentStart(c.charCodeAt(0))) {
            const start = this.pos - 1;
            while (this.hasNext() && isIdentChar(this.src.charCodeAt(this.pos))) {
                this.pos++;
            }
            const value = this.src.substring(start, this.pos);
            return token("ident", new Span(lo, this.posWithOffset), { value });
        }

        if (c === "\n") return token("eol", Span.single(lo));

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
