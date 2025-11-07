import type { Action, Condition, Importable } from "./types";
import { Span } from "./span";

export type Spanned<T> = { value: T; span: Span };

export type IrObject<T> = ({
    [K in keyof T]: K extends "type" ? T[K] : Spanned<Ir<Exclude<T[K], undefined>>> | undefined;
}) & ("type" extends keyof T 
    ? { typeSpan: Span; span: Span } 
    : {});

export type Ir<T> =
    T extends ReadonlyArray<infer U> ? Array<Ir<U>> :
    T extends object ? IrObject<T> :
    T;

export type IrImportable = IrObject<Importable>;
export type IrAction = IrObject<Action>;
export type IrCondition = IrObject<Condition>;

export function unwrapIr<T>(element: Ir<T>): T {
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
