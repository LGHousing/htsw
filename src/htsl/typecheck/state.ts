import Long from "long";

export type Knowledge<T> = { type: "unknown" } | { type: "known"; value: T };

export type NumericValue<T> =
    | { type: "constant"; value: T }
    | { type: "range"; start: T; end: T };

export type NumericKnowledge<T> = Knowledge<NumericValue<T>>;
export type StringKnowledge = Knowledge<string>;

export type VariableType =
    | { type: "long"; value: NumericKnowledge<Long> }
    | { type: "double"; value: NumericKnowledge<number> }
    | { type: "string"; value: StringKnowledge };

export function knownConstant(
    type: "long" | "double" | "string",
    value: number | string
): VariableType {
    switch (type) {
        case "long":
            return {
                type: "long",
                value: {
                    type: "known",
                    value: {
                        type: "constant",
                        value: Long.fromNumber(value as number),
                    },
                },
            };
        case "double":
            return {
                type: "double",
                value: {
                    type: "known",
                    value: {
                        type: "constant",
                        value: value as number,
                    },
                },
            };
        case "string":
            return {
                type: "string",
                value: {
                    type: "known",
                    value: value as string,
                },
            };
    }
}

export function knownRange(
    type: "long" | "double",
    start: number,
    end: number
): VariableType {
    switch (type) {
        case "long":
            return {
                type: "long",
                value: {
                    type: "known",
                    value: {
                        type: "range",
                        start: Long.fromNumber(start),
                        end: Long.fromNumber(end),
                    },
                },
            };
        case "double":
            return {
                type: "double",
                value: {
                    type: "known",
                    value: {
                        type: "range",
                        start: start,
                        end: end,
                    },
                },
            };
    }
}

export function unknown(type: "long" | "double" | "string"): VariableType {
    return { type, value: { type: "unknown" } };
}

export type CertaintyLevel =
    | { certainty: "certainly" }
    | { certainty: "probably" }
    | { certainty: "hopefully" };

export type TypeState = VariableType & CertaintyLevel;
