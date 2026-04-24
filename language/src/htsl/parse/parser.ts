import { partialEq } from "../../helpers";
import type { Lexer } from "./lexer";
import {
    type CloseDelimKind,
    type Delimiter,
    type DocCommentKind,
    type F64Kind,
    type I64Kind,
    type IdentKind,
    type StrKind,
    type Token,
    tokenToString,
} from "./token";
import { Span } from "../../span";
import { Diagnostic } from "../../diagnostic";
import type { Action } from "../../types";
import { parseAction } from "./actions";
import { Long } from "../../long";
import type { GlobalCtxt } from "../../context";

function normalizeNumberLiteral(value: string): string {
    return value.replaceAll("_", "");
}

export class Parser {
    readonly gcx: GlobalCtxt;
    readonly lexer: Lexer;

    tokens: Token[];
    token: Token;
    prev: Token;

    constructor(ctx: GlobalCtxt, lexer: Lexer) {
        this.gcx = ctx;
        this.lexer = lexer;
        this.tokens = [];
        this.token = { kind: "eof", span: new Span(0, 0) };
        this.prev = this.token;
        this.next();
    }

    parseCompletely(): Action[] {
        const actions: Action[] = [];

        while (true) {
            this.eatNewlines();
            if (this.check("eof")) break;

            const action = this.parseRecovering(["eol"], () => parseAction(this));
            if (!this.eat("eol") && !this.check("eof")) {
                // We expect a newline always after an action
                this.gcx.addDiagnostic(
                    Diagnostic.error("Expected end of line")
                        .addPrimarySpan(this.token.span)
                );
            }

            if (action === undefined) continue;
            actions.push(action);
        }

        return actions;
    }

    parseBlock(): Action[] {
        const actions: Action[] = [];
        this.expect({ kind: "open_delim", delim: "brace" });
        while (true) {
            this.eatNewlines();
            if (this.check("eof")) {
                throw Diagnostic.error("expected }")
                    .addPrimarySpan(this.token.span);
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
                this.gcx.addDiagnostic(
                    Diagnostic.error("Expected end of line")
                        .addPrimarySpan(this.token.span)
                );
            }

            actions.push(action);
        }
        return actions;
    }

    parseName(): string {
        if (this.token.kind !== "ident" && this.token.kind !== "str") {
            throw Diagnostic.error("Expected name")
                .addPrimarySpan(this.token.span);
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
            throw Diagnostic.error("Expected true/false value")
                .addPrimarySpan(this.token.span);
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
        const normalize = (value: string) =>
            value.replaceAll(" ", "").replaceAll("_", "").toLowerCase();

        for (const option of options) {
            if (
                this.check("ident") &&
                normalize((this.token as IdentKind).value) === normalize(option)
            ) {
                this.next();
                return option;
            }
        }

        const err = Diagnostic.error(`Expected ${errorTerms?.singular ?? "option"}`)
            .addPrimarySpan(this.token.span);

        function addHelp(message: string) {
            err.addSubDiagnostic(Diagnostic.help(message));
        }

        if (this.check("ident")) {

            addHelp(`Valid ${errorTerms?.plural ?? "options"} are:`)

            const optionsToDisplay = Math.min(5, options.length);
            for (let i = 0; i < optionsToDisplay; i++) {
                addHelp(`  ${options[i].replaceAll(" ", "_")}`);
            }

            if (options.length > 5) {
                addHelp(`And ${options.length - 5} others`);
            }
        }

        else if (this.check("str")) {
            for (const option of options) {
                if (normalize((this.token as StrKind).value) === normalize(option)) {
                    this.next();
                    return option;
                }
            }
        }

        throw err;
    }
    
    parseDocComment(): string {
        this.expect("doc_comment");
        return (this.prev as DocCommentKind).value;
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
            this.gcx.addDiagnostic(
                Diagnostic.error(`Value must be greater than or equal to ${min}`)
                    .addPrimarySpan(span)
            );
        }
        if (Number(value) > max) {
            this.gcx.addDiagnostic(
                Diagnostic.error(`Value must be less than or equal to ${max}`)
                    .addPrimarySpan(span)
            );
        }
        return Number(value);
    }

    parseNumber(): Long {
        const negative = this.eat({ kind: "bin_op", op: "minus" });
        this.expect("i64");

        const value = normalizeNumberLiteral((this.prev as I64Kind).value);
        const withNegative = negative ? `-${value}` : value;
        const long = Long.fromString(withNegative);

        if (withNegative != long.toString()) {
            throw Diagnostic.error("Number exceeds 64-bit integer limit")
                .addPrimarySpan(this.prev.span);
        }

        return long;
    }

    parseDouble(): number {
        const negative = this.eat({ kind: "bin_op", op: "minus" });

        if (this.token.kind !== "i64" && this.token.kind !== "f64") {
            throw Diagnostic.error("Expected number")
                .addPrimarySpan(this.token.span);
        }
        this.next();

        const value = normalizeNumberLiteral((this.prev as F64Kind | I64Kind).value);
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
                throw Diagnostic.error(`expected ${tokenToString({ kind: "close_delim", delim })}`)
                    .addPrimarySpan(this.token.span);
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
                throw Diagnostic.error(`Expected ${tokenToString(closeDelim)}`)
                    .addPrimarySpan(this.token.span);
            }

            seq.push(parser.call(this, this));
            this.eatNewlines();
            if (!this.eat("comma")) {
                if (!this.eat(closeDelim)) {
                    this.gcx.addDiagnostic(
                        Diagnostic.error("expected ,")
                            .addPrimarySpan(this.token.span)
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
                this.gcx.addDiagnostic(e as Diagnostic);
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
            throw Diagnostic.error(`Expected ${tokenToString(tok)}`)
                .addPrimarySpan(this.token.span);
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
