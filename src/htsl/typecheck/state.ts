export type State<T> =
    | { type: "unknown" }
    | { type: "known", value: T[] };

export type NumberOption<T> =
    | { type: "constant", value: T }
    | { type: "range", start: T, end: T };

export type NumberState<T> = State<NumberOption<T>>;
export type StringState = State<string>;

export type TypeOption =
    | { type: "long", value: NumberState<Long> }
    | { type: "double", value: NumberState<number> }
    | { type: "string", value: StringState };

export type TypeState = State<TypeOption>;