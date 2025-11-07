import { partialEq } from "../../helpers";
import type { Lexer } from "./lexer";
import {
    type CloseDelimKind,
    type Delimiter,
    type F64Kind,
    type I64Kind,
    type IdentKind,
    type StrKind,
    type Token,
    tokenToString,
} from "./token";
import { Span } from "../../span";
import { Diagnostic } from "../../diagnostic";
import type { IrAction } from "../../ir";
import { parseAction } from "./actions";
import Long from "long";
import type { ParseContext } from "../../context";

export class Parser {
    readonly ctx: ParseContext;
    readonly lexer: Lexer;

    tokens: Token[];
    token: Token;
    prev: Token;

    constructor(ctx: ParseContext, lexer: Lexer) {
        this.ctx = ctx;
        this.lexer = lexer;
        this.tokens = [];
        this.token = { kind: "eof", span: new Span(0, 0) };
        this.prev = this.token;
        this.next();
    }

    parseCompletely(): IrAction[] {
        const actions: IrAction[] = [];
        
        while (true) {
            this.eatNewlines();
            if (this.check("eof")) break;

            const action = this.parseRecovering(["eol"], () => parseAction(this));
            if (!this.eat("eol") && !this.check("eof")) {
                // We expect a newline always after an action
                this.ctx.addDiagnostic(Diagnostic
                    .error("Expected end of line")
                    .label(this.token.span)
                );
            }

            if (action === undefined) continue;
            actions.push(action);
        }

        return actions;
    }

    parseBlock(): IrAction[] {
        const actions: IrAction[] = [];
        this.expect({ kind: "open_delim", delim: "brace" });
        while (true) {
            this.eatNewlines();
            if (this.check("eof")) {
                throw Diagnostic.error("expected }")
                    .label(this.token.span);
            }

            if (this.eat({ kind: "close_delim", delim: "brace" })) break;

            const action = this.parseRecovering(
                ["eol", { kind: "close_delim", delim: "brace" }],
                parseAction
            );
            if (!action) continue;

            if (
                !this.eat("eol") &&
                !this.check("eof") &&
                !this.check({ kind: "close_delim", delim: "brace" })
            ) {
                this.ctx.addDiagnostic(
                    Diagnostic.error("Expected end of line")
                        .label(this.token.span)
                );
            }

            actions.push(action);
        }
        return actions;
    }

    parseName(): string {
        if (this.token.kind !== "ident" && this.token.kind !== "str") {
            throw Diagnostic.error("Expected name")
                .label(this.token.span);
        }

        const value = this.token.value;
        this.next();
        return value;
    }

    parseBoolean(): boolean {
        let value;
        if (this.eatIdent("true")) value = true;
        if (this.eatIdent("false")) value = false;
        if (value === undefined) {
            throw Diagnostic
                .error("Expected true/false value")
                .label(this.token.span);
        }
        return value;
    }

    /**
     * Attempts to match and return a value from a list of valid options.
     *
     * Matching is case-insensitive and performed against a normalized form of
     * each option, where spaces in the option list are converted to underscores
     * before comparison. The returned value preserves the original formatting
     * from the `options` list.
     * 
     * @param options A list of valid option strings.
     * @param errorFormatting Terms used when generating error messages.
     * @returns The parsed option in its canonical form from the `options` list.
     */
    parseOption<T extends string>(
        options: readonly T[],
        errorTerms?: { singular: string, plural: string },
    ): T {
        for (const option of options) {
            if (this.eatIdent(option.replaceAll(" ", "_"), true)) {
                return option;
            }
        }
    
        const err = Diagnostic.error(`Expected ${errorTerms?.singular ?? "option"}`)
            .label(this.token.span);
    
        if (this.check("ident")) {
            err.hint(`Valid ${errorTerms?.plural ?? "options"} are:`)

            const optionsToDisplay = Math.min(5, options.length);
            for (let i = 0; i < optionsToDisplay; i++) {
                err.hint(`  ${options[i].replaceAll(" ", "_")}`);
            }

            if (options.length > 5) {
                err.hint(`And ${options.length - 5} others`);
            }
        }

        // check for incorrectly formatted options
        else if (this.check("str")) {
            for (const option of options) {
                if (this.eatString(option) || this.eatString(option.replaceAll(" ", "_"))) {
                    err.hint("Convert this string to an identifier");

                    err.edit([
                        { span: this.prev.span, text: option.replaceAll(" ", "_") },
                    ]);
                    break;
                }
            }
        }
    
        throw err;
    }

    parseIdent(): string {
        this.expect("ident");
        return (this.prev as IdentKind).value;
    }

    parseString(): string {
        this.expect("str");
        return (this.prev as StrKind).value;
    }

    parseBoundedNumber(min: number, max: number): number {
        const { value, span } = this.spanned(this.parseNumber);
        if (Number(value) < min) {
            this.ctx.addDiagnostic(
                Diagnostic
                    .error(`Value must be greater than or equal to ${min}`)
                    .label(span)
            );
        }
        if (Number(value) > max) {
            this.ctx.addDiagnostic(
                Diagnostic
                    .error(`Value must be less than or equal to ${max}`)
                    .label(span)
            );
        }
        return Number(value);
    }

    parseNumber(): Long {
        const negative = this.eat({ kind: "bin_op", op: "minus" });
        this.expect("i64");

        const value = (this.prev as I64Kind).value;
        const withNegative = negative ? `-${value}` : value;
        const long = Long.fromString(withNegative);

        if (withNegative != long.toString()) {
            throw Diagnostic
                .error("Number exceeds 64-bit integer limit")
                .label(this.prev.span);
        }

        return long;
    }

    parseDouble(): number {
        const negative = this.eat({ kind: "bin_op", op: "minus" });

        if (this.token.kind !== "i64" && this.token.kind !== "f64") {
            throw Diagnostic
                .error("Expected number")
                .label(this.token.span);
        }
        this.next();

        const value = (this.prev as F64Kind | I64Kind).value;
        const withNegative = negative ? `-${value}` : value;
        const double = parseFloat(withNegative);

        return double;
    }

    parseDelimitedTokens(delim: Delimiter): Token[] {
        const tokens: Token[] = [];
        this.expect({ kind: "open_delim", delim });

        let depth = 1;
        while (true) {
            if (this.check("eof")) {
                throw Diagnostic
                    .error(`expected ${tokenToString({ kind: "close_delim", delim })}`)
                    .label(this.token.span);
            }

            if (this.check({ kind: "close_delim", delim })) {
                if (depth === 1) break;
                depth--;
            } else if (this.check({ kind: "open_delim", delim })) {
                depth++;
            }

            tokens.push(this.token);
            this.next();
        }
        this.next();

        return tokens;
    }

    parseDelimitedCommaSeq<T>(delim: Delimiter, parser: ((p: Parser) => T) | (() => T)) {
        this.expect({ kind: "open_delim", delim });
        const seq: Array<T> = [];
        this.eatNewlines();

        const closeDelim: CloseDelimKind = { kind: "close_delim", delim };
        while (!this.eat(closeDelim)) {
            if (this.token.kind === "eof") {
                // we have reached the end of the file without finding a close delim
                throw Diagnostic
                    .error(`Expected ${tokenToString(closeDelim)}`)
                    .label(this.token.span);
            }

            seq.push(parser.call(this, this));
            this.eatNewlines();
            if (!this.eat("comma")) {
                if (!this.eat(closeDelim)) {
                    this.ctx.addDiagnostic(Diagnostic
                        .error("expected ,")
                        .label(this.token.span)
                    );
                    this.recover([closeDelim]);
                } else break;
            }
            this.eatNewlines();
        }
        return seq;
    }

    parseRecovering<T>(
        recoveryTokens: Array<Token["kind"] | Partial<Token>>,
        parser: ((p: Parser) => T) | (() => T)
    ): T | undefined {
        try {
            return parser.call(this, this);
        } catch (e) {
            if (e instanceof Diagnostic) {
                this.ctx.addDiagnostic(e as Diagnostic);
                this.recover(recoveryTokens);
            } else throw e;
        }
    }

    checkEol(): boolean {
        return this.check("eol") || this.check("eof");
    }

    spanned<T>(parser: ((p: Parser) => T) | (() => T)): { value: T; span: Span } {
        const lo = this.token.span.start;
        const value = parser.call(this, this);
        const hi = this.prev.span.end;
        return { value, span: new Span(lo, hi) };
    }

    eatString(value: string): boolean {
        if (this.token.kind !== "str") return false;
        if (this.token.value.toLowerCase() == value.toLowerCase()) {
            this.next();
            return true;
        }
        return false;
    }

    eatIdent(value: string, caseInsensitive: boolean = false): boolean {
        if (this.token.kind !== "ident") return false;

        if (caseInsensitive) {
            if (this.token.value.toLowerCase() == value.toLowerCase()) {
                this.next();
                return true;
            }
            return false;
        }

        return this.eat({ kind: "ident", value });
    }

    eatNewlines() {
        while (this.eat("eol")) { }
    }

    recover(recoveryTokens: Array<Token["kind"] | Partial<Token>>) {
        while (true) {
            if (recoveryTokens.find((token) => this.check(token)) || this.check("eof")) {
                return;
            }
            this.next();
        }
    }

    expect(tok: Token["kind"] | Partial<Token>) {
        if (!this.eat(tok)) {
            throw Diagnostic
                .error(`Expected ${tokenToString(tok)}`)
                .label(this.token.span);
        }
    }

    eat(tok: Token["kind"] | Partial<Token>): boolean {
        const matches = this.check(tok);
        if (matches) this.next();
        return matches;
    }

    check(tok: Token["kind"] | Partial<Token>): boolean {
        return typeof tok === "string"
            ? this.token.kind === tok
            : partialEq(this.token, tok);
    }

    next() {
        this.prev = this.token;
        if (this.tokens.length === 0) {
            this.tokens.push(this.lexer.advanceToken());
        }
        this.token = this.tokens.shift()!; // this is fine
    }
}
