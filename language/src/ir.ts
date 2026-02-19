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
    // Arrays: unwrap each element
    if (Array.isArray(element)) {
        return element.map(e => unwrapIr(e)) as T;
    }

    // Non-null object case
    if (element !== null && typeof element === "object") {
        const obj: any = element;
        const result: any = {};

        for (const key of Object.keys(obj)) {
            const value = obj[key];

            if (key === "type") {
                // Copy through raw
                result.type = value;
                continue;
            }

            if (key === "typeSpan" || key === "span") {
                // Skip metadata
                continue;
            }

            if (value === undefined) {
                result[key] = undefined;
                continue;
            }

            // Spanned<Ir<U>>: unwrap by returning the inner value
            if (typeof value === "object" && value !== null && "value" in value) {
                result[key] = unwrapIr((value as any).value);
            } else {
                result[key] = unwrapIr(value);
            }
        }

        return result;
    }

    // Primitive (string, number, boolean, null, undefined)
    return element as T;
}

export function irKeys(value: any) {
    return Object.keys(value).filter((it) => !["type", "kwSpan", "span"].includes(it));
}
