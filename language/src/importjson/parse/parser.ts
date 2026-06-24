import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { nodeSpan } from "./helpers";
import type { Span } from "../../span";

export class Parser {
    readonly gcx: GlobalCtxt;
    readonly startPos: number;
    readonly node: json.Node;
    
    constructor(gcx: GlobalCtxt, startPos: number, node: json.Node) {
        this.gcx = gcx;
        this.startPos = startPos;
        this.node = node;
    }

    parseFieldOrUndefined(name: string): Parser | undefined {
        if (this.node.type !== "object" || !this.node.children) {
            throw Diagnostic.error("Expected object")
                .addPrimarySpan(this.span());
        }

        for (const prop of this.node.children ?? []) {
            const [key, value] = prop.children ?? [];

            if (key?.value === name) {
                return new Parser(this.gcx, this.startPos, value);
            }
        }
    }
    
    parseField(name: string): Parser {
        const field = this.parseFieldOrUndefined(name);
        if (!field) {
            throw Diagnostic.error(`Missing required field '${name}'`)
                .addPrimarySpan(this.span().endSpan());
        }
        return field;
    }

    parseFields(): { key: Parser; value: Parser }[] {
        if (this.node.type !== "object" || !this.node.children) {
            throw Diagnostic.error("Expected object")
                .addPrimarySpan(this.span());
        }

        const fields: { key: Parser; value: Parser }[] = [];
        for (const prop of this.node.children) {
            const [key, value] = prop.children ?? [];
            if (!key || !value) continue;
            fields.push({
                key: new Parser(this.gcx, this.startPos, key),
                value: new Parser(this.gcx, this.startPos, value),
            });
        }
        return fields;
    }

    parseArray(): Parser[] {
        if (this.node.type !== "array") {
            throw Diagnostic.error("Expected list")
                .addPrimarySpan(this.span())
        }

        const parsers: Parser[] = [];
        for (const child of this.node.children ?? []) {
            parsers.push(new Parser(this.gcx, this.startPos, child));
        }
        return parsers;
    }

    parseBoolean(): boolean {
        if (this.node.type === "boolean") return this.node.value as boolean;
        if (this.node.type === "string") {
            const v = (this.node.value as string).toLowerCase();
            if (v === "true") return true;
            if (v === "false") return false;
        }
        throw Diagnostic.error("Expected boolean")
            .addPrimarySpan(this.span());
    }

    parseString(): string {
        if (this.node.type !== "string") {
            throw Diagnostic.error("Expected string")
                .addPrimarySpan(this.span())
        }

        return this.node.value as string;
    }

    parseNumber(): number {
        if (this.node.type !== "number") {
            throw Diagnostic.error("Expected number")
                .addPrimarySpan(this.span())
        }

        return this.node.value as number;
    }

    parseBoundedNumber(min: number, max: number): number {
        const value = this.parseNumber();

        if (value < min) {
            this.gcx.addDiagnostic(
                Diagnostic.error(`Value must be greater than or equal to ${min}`)
                    .addPrimarySpan(this.span())
            );
        }
        if (value > max) {
            this.gcx.addDiagnostic(
                Diagnostic.error(`Value must be less than or equal to ${max}`)
                    .addPrimarySpan(this.span())
            );
        }

        return value;
    }

    setNodeSpan<T extends { type: string }>(owner: T) {
        this.gcx.spans.set(owner, this.span());
        this.gcx.spans.setField(owner, "type", this.span());
    }

    setField<T extends object, K extends keyof T>(
        owner: T, key: K, parser: (p: Parser) => T[K],
    ): T[K] {
        const { value, span } = this.withSpan(parser);
        this.gcx.spans.setField(owner, key, span);
        return value;
    }
    
    withSpan<T>(parser: (p: Parser) => T): { value: T, span: Span } {
        const value = parser(this);
        return { value, span: this.span() };
    }

    span(): Span {
        return nodeSpan(this.node, this.startPos);
    }
}