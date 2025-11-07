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

export type CertaintyLevel =
    | { certainty: "certainly" }
    | { certainty: "probably" }
    | { certainty: "hopefully" };

export type TypeState = VariableType & CertaintyLevel;
