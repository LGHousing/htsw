import Long from "long";
import type { Span } from "../../span";
import type { VarHolder, VarOperation } from "../../types";

type Maybe<T> =
    | { isKnown: true, value: T }
    | { isKnown: false };

export type NumericValue<T> =
    | { type: "constant"; constant: T }
    | { type: "range"; start: T; end: T };

export type NumericState<T> = Maybe<NumericValue<T>>;
export type StringState = Maybe<string>;

export type VarState =
    | { type: "long" } & NumericState<Long>
    | { type: "double" } & NumericState<number>
    | { type: "string" } & StringState;

export type DeclaredVarState = VarState & {
    declSpan: Span;
};

export type VarKey = {
    holder: VarHolder;
    key: string;
};

type KnownNumericState<T> = Extract<NumericState<T>, { isKnown: true }>;

function known<T>(value: T): Maybe<T> {
    return { isKnown: true, value };
}

function unknown<T>(): Maybe<T> {
    return { isKnown: false };
}

function constant<T>(value: T): NumericValue<T> {
    return { type: "constant", constant: value };
}

function range<T>(start: T, end: T): NumericValue<T> {
    return { type: "range", start, end };
}

function knownConst<T>(value: T): NumericState<T> {
    return known(constant(value));
}

function knownRange<T>(start: T, end: T): NumericState<T> {
    return known(range(start, end));
}

function unknownNumericState<T>(): NumericState<T> {
    return unknown();
}

function unknownStringState(): StringState {
    return unknown();
}

export function longConst(value: Long): VarState {
    return { type: "long", ...knownConst(value) };
}

export function longRange(start: Long, end: Long): VarState {
    return { type: "long", ...knownRange(start, end) };
}

export function doubleConst(value: number): VarState {
    return { type: "double", ...knownConst(value) };
}

export function doubleRange(start: number, end: number): VarState {
    return { type: "double", ...knownRange(start, end) };
}

export function string(value: string): VarState {
    return { type: "string", ...known(value) };
}

export function unknownLong(): VarState {
    return { type: "long", ...unknownNumericState<Long>() };
}

export function unknownDouble(): VarState {
    return { type: "double", ...unknownNumericState<number>() };
}

export function unknownString(): VarState {
    return { type: "string", ...unknownStringState() };
}

function longMin(a: Long, b: Long): Long {
    return a.lt(b) ? a : b;
}

function longMax(a: Long, b: Long): Long {
    return a.gt(b) ? a : b;
}

function longArrayMin(arr: Long[]): Long {
    let min = arr[0];
    for (let i = 1; i < arr.length; i++) {
        min = longMin(min, arr[i]);
    }
    return min;
}

function longArrayMax(arr: Long[]): Long {
    let max = arr[0];
    for (let i = 1; i < arr.length; i++) {
        max = longMax(max, arr[i]);
    }
    return max;
}

export function applyNumericOperation(
    lhs: KnownNumericState<number> | KnownNumericState<Long>,
    rhs: KnownNumericState<number> | KnownNumericState<Long>,
    op: VarOperation
): NumericState<any> {
    // This shit is really annoying
    const isLongState = (state: KnownNumericState<any>): state is KnownNumericState<Long> => {
        const v = state.value;
        return (
            (v.type === "constant" && typeof v.constant === "object" && typeof v.constant.add === "function") ||
            (v.type === "range" && typeof v.start === "object" && typeof v.start.add === "function")
        );
    };

    const isNumberState = (state: KnownNumericState<any>): state is KnownNumericState<number> => {
        const v = state.value;
        return (
            (v.type === "constant" && typeof v.constant === "number") ||
            (v.type === "range" && typeof v.start === "number")
        );
    };

    if (isLongState(lhs) && isLongState(rhs)) {
        switch (op) {
            case "Increment": return addLongStates(lhs, rhs);
            case "Decrement": return subLongStates(lhs, rhs);
            case "Multiply": return mulLongStates(lhs, rhs);
            case "Divide": return divLongStates(lhs, rhs);
            case "Shift Left": return shlLongStates(lhs, rhs);
            case "Shift Right": return shrLongStates(lhs, rhs);
            case "And Assign": return andLongStates(lhs, rhs);
            case "Or Assign": return orLongStates(lhs, rhs);
            case "Xor Assign": return xorLongStates(lhs, rhs);
            default:
                throw new Error("Invalid operation for type");
        }
    } else if (isNumberState(lhs) && isNumberState(rhs)) {
        switch (op) {
            case "Increment": return addDoubleStates(lhs, rhs);
            case "Decrement": return subDoubleStates(lhs, rhs);
            case "Multiply": return mulDoubleStates(lhs, rhs);
            case "Divide": return divDoubleStates(lhs, rhs);
            default:
                throw new Error("Invalid operation for type");
        }
    } else {
        throw new Error("Numerical operation type mismatch");
    }
}


function addLongStates(
    lhs: KnownNumericState<Long>, rhs: KnownNumericState<Long>
): NumericState<Long> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant.add(rval.constant));
    } else if (lval.type === "range" && rval.type === "range") {
        return knownRange(lval.start.add(rval.start), lval.end.add(rval.end));
    } else if (lval.type === "range" && rval.type === "constant") {
        return knownRange(lval.start.add(rval.constant), lval.end.add(rval.constant));
    } else if (lval.type === "constant" && rval.type === "range") {
        return knownRange(lval.constant.add(rval.start), lval.constant.add(rval.end));
    }
    throw Error("Unreachable");
}

function subLongStates(
    lhs: KnownNumericState<Long>, rhs: KnownNumericState<Long>
): NumericState<Long> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant.sub(rval.constant));
    } else if (lval.type === "range" && rval.type === "range") {
        return knownRange(lval.start.sub(rval.end), lval.end.sub(rval.start));
    } else if (lval.type === "range" && rval.type === "constant") {
        return knownRange(lval.start.sub(rval.constant), lval.end.sub(rval.constant));
    } else if (lval.type === "constant" && rval.type === "range") {
        return knownRange(lval.constant.sub(rval.end), lval.constant.sub(rval.end));
    }
    throw Error("Unreachable");
}

function mulLongStates(
    lhs: KnownNumericState<Long>, rhs: KnownNumericState<Long>
): NumericState<Long> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant.mul(rval.constant));
    } else if (lval.type === "range" && rval.type === "range") {
        return knownRange(lval.start.mul(rval.start), lval.end.mul(rval.end));
    } else if (lval.type === "range" && rval.type === "constant") {
        return knownRange(lval.start.mul(rval.constant), lval.end.mul(rval.constant));
    } else if (lval.type === "constant" && rval.type === "range") {
        return knownRange(lval.constant.mul(rval.start), lval.constant.mul(rval.end));
    }
    throw Error("Unreachable");
}

function divLongStates(
    lhs: KnownNumericState<Long>,
    rhs: KnownNumericState<Long>
): NumericState<Long> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant.div(rval.constant));
    } else if (lval.type === "range" && rval.type === "range") {
        const candidates = [
            lval.start.div(rval.start),
            lval.start.div(rval.end),
            lval.end.div(rval.start),
            lval.end.div(rval.end),
        ];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "range" && rval.type === "constant") {
        const candidates = [lval.start.div(rval.constant), lval.end.div(rval.constant)];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "constant" && rval.type === "range") {
        const candidates = [lval.constant.div(rval.start), lval.constant.div(rval.end)];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    }
    throw Error("Unreachable");
}

function shlLongStates(
    lhs: KnownNumericState<Long>,
    rhs: KnownNumericState<Long>
): NumericState<Long> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant.shl(rval.constant.toInt()));
    } else if (lval.type === "range" && rval.type === "range") {
        const candidates = [
            lval.start.shl(rval.start.toInt()),
            lval.start.shl(rval.end.toInt()),
            lval.end.shl(rval.start.toInt()),
            lval.end.shl(rval.end.toInt()),
        ];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "range" && rval.type === "constant") {
        const candidates = [lval.start.shl(rval.constant.toInt()), lval.end.shl(rval.constant.toInt())];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "constant" && rval.type === "range") {
        const candidates = [lval.constant.shl(rval.start.toInt()), lval.constant.shl(rval.end.toInt())];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    }
    throw Error("Unreachable");
}

function shrLongStates(
    lhs: KnownNumericState<Long>,
    rhs: KnownNumericState<Long>
): NumericState<Long> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant.shr(rval.constant.toInt()));
    } else if (lval.type === "range" && rval.type === "range") {
        const candidates = [
            lval.start.shr(rval.start.toInt()),
            lval.start.shr(rval.end.toInt()),
            lval.end.shr(rval.start.toInt()),
            lval.end.shr(rval.end.toInt()),
        ];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "range" && rval.type === "constant") {
        const candidates = [lval.start.shr(rval.constant.toInt()), lval.end.shr(rval.constant.toInt())];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "constant" && rval.type === "range") {
        const candidates = [lval.constant.shr(rval.start.toInt()), lval.constant.shr(rval.end.toInt())];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    }
    throw Error("Unreachable");
}

function shlULongStates(
    lhs: KnownNumericState<Long>,
    rhs: KnownNumericState<Long>
): NumericState<Long> {
    return shlLongStates(lhs, rhs);
}

function shrULongStates(
    lhs: KnownNumericState<Long>,
    rhs: KnownNumericState<Long>
): NumericState<Long> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant.shiftRightUnsigned(rval.constant.toInt()));
    } else if (lval.type === "range" && rval.type === "range") {
        const candidates = [
            lval.start.shiftRightUnsigned(rval.start.toInt()),
            lval.start.shiftRightUnsigned(rval.end.toInt()),
            lval.end.shiftRightUnsigned(rval.start.toInt()),
            lval.end.shiftRightUnsigned(rval.end.toInt()),
        ];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "range" && rval.type === "constant") {
        const candidates = [lval.start.shiftRightUnsigned(rval.constant.toInt()), lval.end.shiftRightUnsigned(rval.constant.toInt())];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "constant" && rval.type === "range") {
        const candidates = [lval.constant.shiftRightUnsigned(rval.start.toInt()), lval.constant.shiftRightUnsigned(rval.end.toInt())];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    }
    throw Error("Unreachable");
}

function andLongStates(
    lhs: KnownNumericState<Long>,
    rhs: KnownNumericState<Long>
): NumericState<Long> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant.and(rval.constant));
    } else if (lval.type === "range" && rval.type === "range") {
        const candidates = [
            lval.start.and(rval.start),
            lval.start.and(rval.end),
            lval.end.and(rval.start),
            lval.end.and(rval.end),
        ];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "range" && rval.type === "constant") {
        const candidates = [lval.start.and(rval.constant), lval.end.and(rval.constant)];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "constant" && rval.type === "range") {
        const candidates = [lval.constant.and(rval.start), lval.constant.and(rval.end)];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    }
    throw Error("Unreachable");
}

function orLongStates(
    lhs: KnownNumericState<Long>,
    rhs: KnownNumericState<Long>
): NumericState<Long> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant.or(rval.constant));
    } else if (lval.type === "range" && rval.type === "range") {
        const candidates = [
            lval.start.or(rval.start),
            lval.start.or(rval.end),
            lval.end.or(rval.start),
            lval.end.or(rval.end),
        ];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "range" && rval.type === "constant") {
        const candidates = [lval.start.or(rval.constant), lval.end.or(rval.constant)];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "constant" && rval.type === "range") {
        const candidates = [lval.constant.or(rval.start), lval.constant.or(rval.end)];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    }
    throw Error("Unreachable");
}

function xorLongStates(
    lhs: KnownNumericState<Long>,
    rhs: KnownNumericState<Long>
): NumericState<Long> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant.xor(rval.constant));
    } else if (lval.type === "range" && rval.type === "range") {
        const candidates = [
            lval.start.xor(rval.start),
            lval.start.xor(rval.end),
            lval.end.xor(rval.start),
            lval.end.xor(rval.end),
        ];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "range" && rval.type === "constant") {
        const candidates = [lval.start.xor(rval.constant), lval.end.xor(rval.constant)];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    } else if (lval.type === "constant" && rval.type === "range") {
        const candidates = [lval.constant.xor(rval.start), lval.constant.xor(rval.end)];
        return knownRange(longArrayMin(candidates), longArrayMax(candidates));
    }
    throw Error("Unreachable");
}

function addDoubleStates(
    lhs: KnownNumericState<number>,
    rhs: KnownNumericState<number>
): NumericState<number> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant + rval.constant);
    } else if (lval.type === "range" && rval.type === "range") {
        return knownRange(lval.start + rval.start, lval.end + rval.end);
    } else if (lval.type === "range" && rval.type === "constant") {
        return knownRange(lval.start + rval.constant, lval.end + rval.constant);
    } else if (lval.type === "constant" && rval.type === "range") {
        return knownRange(lval.constant + rval.start, lval.constant + rval.end);
    }
    throw Error("Unreachable");
}

function subDoubleStates(
    lhs: KnownNumericState<number>,
    rhs: KnownNumericState<number>
): NumericState<number> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant - rval.constant);
    } else if (lval.type === "range" && rval.type === "range") {
        return knownRange(lval.start - rval.end, lval.end - rval.start);
    } else if (lval.type === "range" && rval.type === "constant") {
        return knownRange(lval.start - rval.constant, lval.end - rval.constant);
    } else if (lval.type === "constant" && rval.type === "range") {
        return knownRange(lval.constant - rval.end, lval.constant - rval.start);
    }
    throw Error("Unreachable");
}

function mulDoubleStates(
    lhs: KnownNumericState<number>,
    rhs: KnownNumericState<number>
): NumericState<number> {
    const lval = lhs.value;
    const rval = rhs.value;

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(lval.constant * rval.constant);
    } else if (lval.type === "range" && rval.type === "range") {
        const candidates = [
            lval.start * rval.start,
            lval.start * rval.end,
            lval.end * rval.start,
            lval.end * rval.end,
        ];
        return knownRange(Math.min(...candidates), Math.max(...candidates));
    } else if (lval.type === "range" && rval.type === "constant") {
        const candidates = [lval.start * rval.constant, lval.end * rval.constant];
        return knownRange(Math.min(...candidates), Math.max(...candidates));
    } else if (lval.type === "constant" && rval.type === "range") {
        const candidates = [lval.constant * rval.start, lval.constant * rval.end];
        return knownRange(Math.min(...candidates), Math.max(...candidates));
    }
    throw Error("Unreachable");
}

function divDoubleStates(
    lhs: KnownNumericState<number>,
    rhs: KnownNumericState<number>
): NumericState<number> {
    const lval = lhs.value;
    const rval = rhs.value;

    const safeDiv = (a: number, b: number) => (b === 0 ? a / 1 : a / b);

    if (lval.type === "constant" && rval.type === "constant") {
        return knownConst(safeDiv(lval.constant, rval.constant));
    } else if (lval.type === "range" && rval.type === "range") {
        const candidates = [
            safeDiv(lval.start, rval.start),
            safeDiv(lval.start, rval.end),
            safeDiv(lval.end, rval.start),
            safeDiv(lval.end, rval.end),
        ];
        return knownRange(Math.min(...candidates), Math.max(...candidates));
    } else if (lval.type === "range" && rval.type === "constant") {
        const candidates = [safeDiv(lval.start, rval.constant), safeDiv(lval.end, rval.constant)];
        return knownRange(Math.min(...candidates), Math.max(...candidates));
    } else if (lval.type === "constant" && rval.type === "range") {
        const candidates = [safeDiv(lval.constant, rval.start), safeDiv(lval.constant, rval.end)];
        return knownRange(Math.min(...candidates), Math.max(...candidates));
    }
    throw Error("Unreachable");
}