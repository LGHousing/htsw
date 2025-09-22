import type { Action, ActionHolder, Condition } from "./types";
import { Span } from "./span";
import { Diagnostic } from "./diagnostic";

type SpanElement<T> = [T] extends [Action]
    ? IrAction
    : [T] extends [Condition]
      ? IrCondition
      : T;

type SpanArray<U> = {
    value: SpanElement<U>[];
    span: Span;
};

export type Spanned<T> = [T] extends [any[]]
    ? SpanArray<T[number]>
    : { value: SpanElement<T>; span: Span };

export type Element = { type: string };

export type Ir<T extends Element> = {
    type: T["type"];
    span: Span;
    kwSpan: Span;
} & {
    [K in keyof T]: K extends "type" ? T[K] : Spanned<NonNullable<T[K]>> | undefined;
};

export type IrAction = Ir<Action>;
export type IrCondition = Ir<Condition>;
export type IrActionHolder = Ir<ActionHolder>;

export type ParseResult = {
    holders: IrActionHolder[];
    diagnostics: Diagnostic[];
};

export function unwrapIr<T extends Element>(element: Ir<T>): T {
    return unwrapTransform(element);
}

function unwrapTransform(ir: any): any {
    const result: any = { type: ir.type };

    for (const key in ir) {
        if (key === "type" || key === "kwSpan" || key === "span") continue;
        result[key] = unwrapValue(ir[key]);
    }
    return result;
}

function unwrapValue(value: any): any {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
        return value.map(unwrapValue);
    }
    if (typeof value === "object") {
        if ("type" in value && "kwSpan" in value && "span" in value) {
            return unwrapTransform(value);
        }
        if ("value" in value && "span" in value) {
            return unwrapValue(value.value);
        }
    }
    return value;
}

export function irKeys(value: any) {
    return Object.keys(value).filter((it) => !["type", "kwSpan", "span"].includes(it));
}
