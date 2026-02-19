import type { SourceFile } from "../../sourceMap";
import { Span } from "../../span";
import { token, type Token } from "./token";

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
        while (this.hasNext() && /^\s+$/.test(this.peek()) && this.peek() != "\n") {
            this.next();
        }
        if (!this.hasNext())
            return token("eof", new Span(this.posWithOffset, this.posWithOffset));

        const lo = this.posWithOffset;
        const singleSpan = new Span(lo, lo + 1);
        const c = this.next();

        if (c === "/" && this.peek() === "/") {
            if (this.peek(1) == "/") {
                this.next();
                this.next();

                // parse doc comment
                let value = "";
                
                do {
                    value += this.next();
                } while (this.hasNext() && this.peek() !== "\n");

                // this is so cringe
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

        if (c === ",") return token("comma", singleSpan);
        if (c === "!") return token("exclamation", singleSpan);

        // binary operators
        if (c === "+") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "plus" });
            }
            return token("bin_op", singleSpan, { op: "plus" });
        }
        if (c === "-") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "minus" });
            }
            return token("bin_op", singleSpan, { op: "minus" });
        }
        if (c === "*") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "star" });
            }
            return token("bin_op", singleSpan, { op: "star" });
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
            return token("bin_op", singleSpan, { op: "lt_lt" });
        }
        if (c === ">" && this.peek(0) == ">") {
            this.next();
            if (this.peek(0) === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 3), { op: "gt_gt" });
            }
            return token("bin_op", singleSpan, { op: "gt_gt" });
        }
        if (c === "&") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "ampersand" });
            }
            return token("bin_op", singleSpan, { op: "ampersand" });
        }
        if (c === "|") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "vertical_bar" });
            }
            return token("bin_op", singleSpan, { op: "vertical_bar" });
        }
        if (c === "^") {
            if (this.peek() === "=") {
                this.next();
                return token("bin_op_eq", new Span(lo, lo + 2), { op: "caret" });
            }
            return token("bin_op", singleSpan, { op: "caret" });
        }

        // comparison operators
        if (c === "=") {
            if (this.peek(0) === "=") {
                this.next();
                return token("cmp_op_eq", new Span(lo, lo + 2), { op: "equals" });
            }
            return token("cmp_op", singleSpan, { op: "equals" });
        }
        if (c === "<") {
            if (this.peek(0) === "=") {
                this.next();
                return token("cmp_op_eq", new Span(lo, lo + 2), { op: "less_than" });
            }
            return token("cmp_op", singleSpan, { op: "less_than" });
        }
        if (c === ">") {
            if (this.peek(0) === "=") {
                this.next();
                return token("cmp_op_eq", new Span(lo, lo + 2), { op: "greater_than" });
            }
            return token("cmp_op", singleSpan, { op: "greater_than" });
        }

        // delimiters
        if (c === "(") return token("open_delim", singleSpan, { delim: "parenthesis" });
        if (c === ")") return token("close_delim", singleSpan, { delim: "parenthesis" });
        if (c === "{") return token("open_delim", singleSpan, { delim: "brace" });
        if (c === "}") return token("close_delim", singleSpan, { delim: "brace" });
        if (c === "[") return token("open_delim", singleSpan, { delim: "bracket" });
        if (c === "]") return token("close_delim", singleSpan, { delim: "bracket" });

        // literals
        if (c === '"') {
            let value = "";
            let escapeNext = false;
            while (this.hasNext()) {
                const c = this.next();
                if (!escapeNext && c === '"') break;
                if (!escapeNext && c === "\\") {
                    escapeNext = true;
                    continue;
                }
                escapeNext = false;
                value += c;
            }

            return token("str", new Span(lo, this.posWithOffset), { value });
        }

        if (c === "%") {
            let value = "";
            while (this.hasNext()) {
                const c = this.next();
                if (c === "%") break;
                value += c;
            }

            return token("placeholder", new Span(lo, this.posWithOffset), { value });
        }

        if (/[0-9]/.test(c)) {
            let value = c;
            while (this.hasNext()) {
                if (!/[0-9]/.test(this.peek())) break;
                value += this.next();
            }
            if (this.peek() === ".") {
                value += ".";
                this.next();
                while (this.hasNext()) {
                    if (!/[0-9]/.test(this.peek())) break;
                    value += this.next();
                }
                return token("f64", new Span(lo, this.posWithOffset), { value });
            }
            return token("i64", new Span(lo, this.posWithOffset), { value });
        }

        if (/[a-zA-Z_]/.test(c)) {
            let value = c;
            while (this.hasNext()) {
                if (!/[a-zA-Z_/\-0-9.-]/.test(this.peek())) break;
                value += this.next();
            }
            return token("ident", new Span(lo, this.posWithOffset), { value });
        }

        if (c === "\n") return token("eol", singleSpan);

        return token("unknown", singleSpan, { value: c });
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
