import { Span } from '../span';
import { token, type Token } from './token';

export class Lexer {
    src: string;
    pos: number;

    constructor(src: string) {
        this.src = src;
        this.pos = 0;
    }

    advanceToken(): Token {
        // eat whitespace
        while (this.hasNext() && /^\s+$/.test(this.peek()) && this.peek() != '\n') {
            this.next();
        }
        if (!this.hasNext()) return token('eof', new Span(this.pos, this.pos));

        const lo = this.pos;
        const singleSpan = new Span(lo, lo + 1);
        const c = this.next();

        if (c === '/' && this.peek() === '/') {
            // eat line comment
            do {
                this.next();
            } while (this.hasNext() && this.peek() !== '\n');

            return this.advanceToken();
        }

        if (c === '/' && this.peek() === '*') {
            this.next();

            // eat block comment
            let depth = 1;
            while (this.hasNext()) {
                const c = this.next();
                if (c === '/' && this.peek() === '*') {
                    this.next();
                    depth++;
                } else if (c === '*' && this.peek() === '/') {
                    this.next();
                    depth--;
                    if (depth === 0) break;
                }
            }

            return this.advanceToken();
        }

        if (c === ',') return token('comma', singleSpan);
        if (c === '!') return token('exclamation', singleSpan);

        // binary operators
        if (c === '+') {
            if (this.peek(0) === '=') {
                this.next();
                return token('bin_op_eq', new Span(lo, lo + 2), { op: 'plus' });
            }
            return token('bin_op', singleSpan, { op: 'plus' });
        }
        if (c === '-') {
            if (this.peek(0) === '=') {
                this.next();
                return token('bin_op_eq', new Span(lo, lo + 2), { op: 'minus' });
            }
            return token('bin_op', singleSpan, { op: 'minus' });
        }
        if (c === '*') {
            if (this.peek(0) === '*') {
                this.next();
                return token('bin_op', new Span(lo, lo + 2), { op: 'star_star' });
            }
            if (this.peek(0) === '=') {
                this.next();
                return token('bin_op_eq', new Span(lo, lo + 2), { op: 'star' });
            }
            return token('bin_op', singleSpan, { op: 'star' });
        }
        if (c === '/') {
            if (this.peek(0) === '/') this.next();
            if (this.peek(0) === '=') {
                this.next();
                return token('bin_op_eq', new Span(lo, this.pos), { op: 'slash' });
            }
            return token('bin_op', new Span(lo, this.pos), { op: 'slash' });
        }

        // comparison operators
        if (c === '=') {
            if (this.peek(0) === '=') {
                this.next();
                return token('cmp_op_eq', new Span(lo, lo + 2), { op: 'equals' });
            }
            return token('cmp_op', singleSpan, { op: 'equals' });
        }
        if (c === '<') {
            if (this.peek(0) === '=') {
                this.next();
                return token('cmp_op_eq', new Span(lo, lo + 2), { op: 'less_than' });
            }
            return token('cmp_op', singleSpan, { op: 'less_than' });
        }
        if (c === '>') {
            if (this.peek(0) === '=') {
                this.next();
                return token('cmp_op_eq', new Span(lo, lo + 2), { op: 'greater_than' });
            }
            return token('cmp_op', singleSpan, { op: 'greater_than' });
        }

        // delimiters
        if (c === '(') return token('open_delim', singleSpan, { delim: 'parenthesis' });
        if (c === ')') return token('close_delim', singleSpan, { delim: 'parenthesis' });
        if (c === '{') return token('open_delim', singleSpan, { delim: 'brace' });
        if (c === '}') return token('close_delim', singleSpan, { delim: 'brace' });
        if (c === '[') return token('open_delim', singleSpan, { delim: 'bracket' });
        if (c === ']') return token('close_delim', singleSpan, { delim: 'bracket' });

        // literals
        if (c === '"') {
            let value = '';
            let escapeNext = false;
            while (this.hasNext()) {
                const c = this.next();
                if (!escapeNext && c === '"') break;
                if (!escapeNext && c === '\\') {
                    escapeNext = true;
                    continue;
                }
                escapeNext = false;
                value += c;
            }

            return token('str', new Span(lo, this.pos), { value });
        }

        if (c === '%') {
            let value = '';
            while (this.hasNext()) {
                const c = this.next();
                if (c === '%') break;
                value += c;
            }

            return token('placeholder', new Span(lo, this.pos), { value });
        }

        if (/[0-9]/.test(c)) {
            let value = c;
            while (this.hasNext()) {
                if (!/[0-9]/.test(this.peek())) break;
                value += this.next();
            }
            if (this.peek() === '.') {
                value += '.';
                this.next();
                while (this.hasNext()) {
                    if (!/[0-9]/.test(this.peek())) break;
                    value += this.next();
                }
                return token('f64', new Span(lo, this.pos), { value });
            }
            return token('i64', new Span(lo, this.pos), { value });
        }

        if (/[a-zA-Z_]/.test(c)) {
            let value = c;
            while (this.hasNext()) {
                if (!/[a-zA-Z_/\-0-9.-]/.test(this.peek())) break;
                value += this.next();
            }
            return token('ident', new Span(lo, this.pos), { value });
        }

        if (c === '\n') return token('eol', singleSpan);

        return token('unknown', singleSpan, { value: c });
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
