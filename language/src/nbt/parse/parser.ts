import { Long } from "../../long";

import type { GlobalCtxt } from "../../context";
import { partialEq } from "../../helpers";
import { Diagnostic } from "../../diagnostic";
import { Span } from "../../span";
import type { Tag } from "../types";
import { Lexer } from "./lexer";
import type { BareKind, StrKind, Token } from "./token";
import { tokenToString } from "./token";

export class Parser {
    readonly gcx: GlobalCtxt;
    readonly lexer: Lexer;

    token: Token;
    prev: Token;

    constructor(gcx: GlobalCtxt, lexer: Lexer) {
        this.gcx = gcx;
        this.lexer = lexer;
        this.token = { kind: "eof", span: new Span(0, 0) };
        this.prev = this.token;
        this.next();
    }

    parseCompletely(): Tag {
        const value = this.parseTag();

        if (!this.check("eof")) {
            throw Diagnostic.error(`Expected ${tokenToString("eof")}`)
                .addPrimarySpan(this.token.span);
        }

        return value;
    }

    parseTag(): Tag {
        if (this.check({ kind: "open_delim", delim: "brace" })) {
            return this.parseCompound();
        }

        if (this.check({ kind: "open_delim", delim: "bracket" })) {
            return this.parseListOrArray();
        }

        if (this.check("str")) {
            this.next();
            return this.withValueSpan(
                { type: "string", value: (this.prev as StrKind).value },
                this.prev.span,
                this.prev.span,
            );
        }

        if (this.check("bare")) {
            this.next();
            return this.parseBareTag((this.prev as BareKind).value, this.prev.span);
        }

        throw Diagnostic.error("Expected SNBT value")
            .addPrimarySpan(this.token.span);
    }

    parseCompound(): Tag {
        const lo = this.token.span.start;
        this.expect({ kind: "open_delim", delim: "brace" });

        const value: Record<string, Tag | undefined> = {};
        this.gcx.spans.set(value, this.prev.span);
        while (true) {
            if (this.eat({ kind: "close_delim", delim: "brace" })) break;

            const key = this.parseKey();
            this.expect("colon");
            const tag = this.parseTag();
            value[key] = tag;
            this.gcx.spans.setField(value, key, this.gcx.spans.get(tag));

            if (this.eat("comma")) {
                if (this.eat({ kind: "close_delim", delim: "brace" })) break;
                continue;
            }

            if (this.eat({ kind: "close_delim", delim: "brace" })) break;

            throw Diagnostic.error(
                `Expected ${tokenToString("comma")}`,
            ).addPrimarySpan(this.token.span);
        }

        const span = new Span(lo, this.prev.span.end);
        this.gcx.spans.set(value, span);
        return this.withValueSpan({ type: "compound", value }, span, span);
    }

    parseListOrArray(): Tag {
        const lo = this.token.span.start;
        this.expect({ kind: "open_delim", delim: "bracket" });

        if (this.eat({ kind: "close_delim", delim: "bracket" })) {
            const span = new Span(lo, this.prev.span.end);
            const value = { type: "int" as Tag["type"], value: [] as Tag["value"][] };
            this.gcx.spans.set(value, span);
            this.gcx.spans.setField(value, "value", span);
            return this.withValueSpan({
                type: "list",
                value,
            }, span, span);
        }

        if (this.check("bare")) {
            const prefix = (this.token as BareKind).value;
            const prefixSpan = this.token.span;
            if (isArrayPrefix(prefix)) {
                this.next();
                if (this.eat("semicolon")) {
                    return this.parseTypedArray(toUpperArrayPrefix(prefix), prefixSpan, lo);
                }

                // Not an array prefix sequence like [X; ...], treat as list element.
                return this.parseListFromFirst(this.parseBareTag(prefix, prefixSpan), lo);
            }
        }

        return this.parseListFromFirst(this.parseTag(), lo);
    }

    parseListFromFirst(first: Tag, lo: number): Tag {
        const elementType = first.type;
        const values = [first.value];

        while (true) {
            if (this.eat({ kind: "close_delim", delim: "bracket" })) break;

            this.expect("comma");
            if (this.eat({ kind: "close_delim", delim: "bracket" })) break;

            const tag = this.parseTag();
            if (tag.type !== elementType) {
                throw Diagnostic.error("SNBT list values must have the same tag type")
                    .addPrimarySpan(this.prev.span, `Expected ${elementType}`);
            }
            values.push(tag.value);
        }

        const span = new Span(lo, this.prev.span.end);
        const value = {
            type: elementType,
            value: values as Tag["value"][],
        };
        this.gcx.spans.set(value, span);
        this.gcx.spans.setField(value, "value", span);
        return this.withValueSpan({
            type: "list",
            value,
        }, span, span);
    }

    parseTypedArray(prefix: "B" | "S" | "I" | "L", prefixSpan: Span, lo: number): Tag {
        if (this.eat({ kind: "close_delim", delim: "bracket" })) {
            const span = new Span(lo, this.prev.span.end);
            if (prefix === "B") return this.withValueSpan({ type: "byte_array", value: [] }, span, span);
            if (prefix === "S") return this.withValueSpan({ type: "short_array", value: [] }, span, span);
            if (prefix === "I") return this.withValueSpan({ type: "int_array", value: [] }, span, span);
            return this.withValueSpan({ type: "long_array", value: [] }, span, span);
        }

        if (prefix === "B") {
            const value = this.parseNumberArray("byte");
            const span = new Span(lo, this.prev.span.end);
            return this.withValueSpan({ type: "byte_array", value }, span, span);
        }
        if (prefix === "S") {
            const value = this.parseNumberArray("short");
            const span = new Span(lo, this.prev.span.end);
            return this.withValueSpan({ type: "short_array", value }, span, span);
        }
        if (prefix === "I") {
            const value = this.parseNumberArray("int");
            const span = new Span(lo, this.prev.span.end);
            return this.withValueSpan({ type: "int_array", value }, span, span);
        }

        if (prefix !== "L") {
            throw Diagnostic.error(`Unsupported typed array prefix '${prefix}'`)
                .addPrimarySpan(prefixSpan);
        }
        const value = this.parseLongArray();
        const span = new Span(lo, this.prev.span.end);
        return this.withValueSpan({ type: "long_array", value }, span, span);
    }

    parseNumberArray(kind: "byte" | "short" | "int"): number[] {
        const values: number[] = [];
        while (true) {
            this.expect("bare");
            const tag = this.parseBareTag((this.prev as BareKind).value, this.prev.span);

            if (tag.type !== kind) {
                throw Diagnostic.error(`Expected ${kind} literal`)
                    .addPrimarySpan(this.prev.span)
                    .addSecondarySpan(this.prev.span, `Got ${tag.type}`);
            }
            values.push(tag.value);

            if (this.eat({ kind: "close_delim", delim: "bracket" })) break;
            this.expect("comma");
            if (this.eat({ kind: "close_delim", delim: "bracket" })) break;
        }
        return values;
    }

    parseLongArray(): Long[] {
        const values: Long[] = [];
        while (true) {
            this.expect("bare");
            const tag = this.parseBareTag((this.prev as BareKind).value, this.prev.span);

            if (tag.type !== "long") {
                throw Diagnostic.error("Expected long literal")
                    .addPrimarySpan(this.prev.span)
                    .addSecondarySpan(this.prev.span, `Got ${tag.type}`);
            }
            values.push(tag.value);

            if (this.eat({ kind: "close_delim", delim: "bracket" })) break;
            this.expect("comma");
            if (this.eat({ kind: "close_delim", delim: "bracket" })) break;
        }
        return values;
    }

    parseKey(): string {
        if (this.check("str")) {
            this.next();
            return (this.prev as StrKind).value;
        }

        if (this.check("bare")) {
            this.next();
            return (this.prev as BareKind).value;
        }

        throw Diagnostic.error("Expected object key")
            .addPrimarySpan(this.token.span);
    }

    parseBareTag(raw: string, span: Span): Tag {
        const lower = raw.toLowerCase();

        if (lower === "true") return this.withValueSpan({ type: "byte", value: 1 }, span, span);
        if (lower === "false") return this.withValueSpan({ type: "byte", value: 0 }, span, span);

        const parsed = parseNumericRaw(raw);
        if (!parsed) return this.withValueSpan({ type: "string", value: raw }, span, span);

        const kind = parsed.suffix;
        if (kind === "b") {
            return this.withValueSpan(
                { type: "byte", value: assertRangeInt(parsed.value, -128, 127, "byte", span) },
                span, span,
            );
        }
        if (kind === "s") {
            return this.withValueSpan(
                { type: "short", value: assertRangeInt(parsed.value, -32768, 32767, "short", span) },
                span, span,
            );
        }
        if (kind === "i") {
            return this.withValueSpan(
                { type: "int", value: assertRangeInt(parsed.value, -2147483648, 2147483647, "int", span) },
                span, span,
            );
        }
        if (kind === "l") {
            return this.withValueSpan(
                { type: "long", value: parseLong(parsed.rawNoSuffix, span) },
                span, span,
            );
        }
        if (kind === "f") {
            return this.withValueSpan(
                { type: "float", value: assertFinite(parsed.value, "float", span) },
                span, span,
            );
        }
        if (kind === "d") {
            return this.withValueSpan(
                { type: "double", value: assertFinite(parsed.value, "double", span) },
                span, span,
            );
        }

        if (parsed.isFloatLike) {
            return this.withValueSpan(
                { type: "double", value: assertFinite(parsed.value, "double", span) },
                span, span,
            );
        }

        if (!Number.isSafeInteger(parsed.value)) {
            return this.withValueSpan(
                { type: "long", value: parseLong(parsed.rawNoSuffix, span) },
                span, span,
            );
        }

        if (parsed.value < -2147483648 || parsed.value > 2147483647) {
            return this.withValueSpan(
                { type: "long", value: parseLong(parsed.rawNoSuffix, span) },
                span, span,
            );
        }

        return this.withValueSpan({ type: "int", value: parsed.value }, span, span);
    }

    withValueSpan<T extends Tag>(tag: T, span: Span, valueSpan: Span): T {
        this.gcx.spans.set(tag, span);
        this.gcx.spans.setField(tag, "value", valueSpan);
        return tag;
    }

    next() {
        this.prev = this.token;
        this.token = this.lexer.advanceToken();
    }

    check(tok: Token["kind"] | Partial<Token>): boolean {
        return typeof tok === "string"
            ? this.token.kind === tok
            : partialEq(this.token, tok);
    }

    eat(tok: Token["kind"] | Partial<Token>): boolean {
        const matches = this.check(tok);
        if (matches) this.next();
        return matches;
    }

    expect(tok: Token["kind"] | Partial<Token>) {
        if (!this.eat(tok)) {
            throw Diagnostic.error(`Expected ${tokenToString(tok)}`)
                .addPrimarySpan(this.token.span);
        }
    }
}

function isArrayPrefix(raw: string): raw is "B" | "b" | "S" | "s" | "I" | "i" | "L" | "l" {
    return raw.length === 1 && /[bBsSiIlL]/.test(raw);
}

function toUpperArrayPrefix(raw: "B" | "b" | "S" | "s" | "I" | "i" | "L" | "l"): "B" | "S" | "I" | "L" {
    if (raw === "b" || raw === "B") return "B";
    if (raw === "s" || raw === "S") return "S";
    if (raw === "i" || raw === "I") return "I";
    return "L";
}

function assertFinite(value: number, typeName: string, span: Span): number {
    if (Number.isFinite(value)) return value;
    throw Diagnostic.error(`${typeName} literal is not finite`)
        .addPrimarySpan(span);
}

function assertRangeInt(
    value: number,
    min: number,
    max: number,
    typeName: string,
    span: Span,
): number {
    if (!Number.isInteger(value)) {
        throw Diagnostic.error(`${typeName} literal must be an integer`)
            .addPrimarySpan(span);
    }
    if (value < min || value > max) {
        throw Diagnostic.error(`${typeName} literal out of range`)
            .addPrimarySpan(span)
            .addSubDiagnostic(Diagnostic.note(`Expected range ${min}..${max}`));
    }
    return value;
}

function parseLong(raw: string, span: Span): Long {
    if (!/^[+-]?\d+$/.test(raw)) {
        throw Diagnostic.error("long literal must be an integer")
            .addPrimarySpan(span);
    }

    const long = Long.fromString(raw);
    if (long.toString() !== normalizeIntegerString(raw)) {
        throw Diagnostic.error("long literal out of 64-bit range")
            .addPrimarySpan(span);
    }
    return long;
}

function normalizeIntegerString(raw: string): string {
    const sign = raw.startsWith("-") ? "-" : "";
    const digits = raw.replace(/^[+-]/, "").replace(/^0+/, "") || "0";
    if (digits === "0") return "0";
    return `${sign}${digits}`;
}

function parseNumericRaw(raw: string): {
    rawNoSuffix: string;
    value: number;
    suffix?: "b" | "s" | "i" | "l" | "f" | "d";
    isFloatLike: boolean;
} | undefined {
    const match = raw.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([bBsSiIlLfFdD])?$/);
    if (!match) return undefined;

    const value = Number(match[1]);
    if (Number.isNaN(value)) return undefined;

    return {
        rawNoSuffix: match[1],
        value,
        suffix: match[2]?.toLowerCase() as "b" | "s" | "i" | "l" | "f" | "d" | undefined,
        isFloatLike: match[1].includes(".") || /[eE]/.test(match[1]),
    };
}
