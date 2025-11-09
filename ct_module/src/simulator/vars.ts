import type { Comparison, Operation, VarOperation } from "htsw/types";

import Long from "long";
import { parsePlaceholder } from "./placeholders";
import { formatNumber, isLong, parseLong } from "./helpers";

export interface Var<T> {
    value: T;
    type: string;

    binOp(other: Var<T>, op: VarOperation): Var<T>;
    cmpOp(other: Var<any>, op: Comparison): boolean;

    shouldUnset(): boolean;

    toLong(): Long;
    toDouble(): number;
    toString(): string;
}

export class VarLong implements Var<Long> {
    value: Long;
    type = "long";

    constructor(value: Long) {
        this.value = value;
    }

    static fromString(string: string): VarLong {
        return new VarLong(parseLong(string));
    }

    static fromNumber(number: number): VarLong {
        return new VarLong(Long.fromNumber(number));
    }

    binOp(other: Var<Long>, op: VarOperation): Var<Long> {
        switch (op) {
            case "Set":
                return other;
            case "Increment":
                return new VarLong(this.value.add(other.value));
            case "Decrement":
                return new VarLong(this.value.sub(other.value));
            case "Multiply":
                return new VarLong(this.value.mul(other.value));
            case "Divide":
                return new VarLong(this.value.div(other.value));
            case "Shift Left":
                return new VarLong(this.value.shiftLeft(other.value));
            case "Shift Right":
                return new VarLong(this.value.shiftRight(other.value));
            case "And Assign":
                return new VarLong(this.value.and(other.value));
            case "Or Assign":
                return new VarLong(this.value.or(other.value));
            case "Xor Assign":
                return new VarLong(this.value.xor(other.value));
            case "Unset":
                throw new Error("Unset operation should not run as binOp");
        }
    }

    cmpOp(other: Var<any>, op: Comparison): boolean {
        switch (op) {
            case "Equal":
                return this.value.eq(other.value);
            case "Less Than":
                return this.value.lt(other.value);
            case "Less Than Or Equal":
                return this.value.lte(other.value);
            case "Greater Than":
                return this.value.gt(other.value);
            case "Greater Than Or Equal":
                return this.value.gte(other.value);
        }
    }

    shouldUnset(): boolean {
        return this.value.equals(Long.ZERO);
    }

    toLong(): Long {
        return this.value;
    }

    toDouble(): number {
        return this.value.toNumber();
    }

    toString(): string {
        return formatNumber(this.value.toString());
    }
}

export class VarDouble implements Var<number> {
    value: number;
    type = "double";

    constructor(value: number) {
        this.value = value;
    }

    static fromString(string: string): VarDouble {
        return new VarDouble(parseFloat(string));
    }

    binOp(other: Var<number>, op: VarOperation): Var<number> {
        switch (op) {
            case "Set":
                return other;
            case "Increment":
                return new VarDouble(this.value + other.value);
            case "Decrement":
                return new VarDouble(this.value - other.value);
            case "Multiply":
                return new VarDouble(this.value * other.value);
            case "Divide":
                return new VarDouble(this.value / other.value);
            default:
                throw new Error("Not implemented");
        }
    }

    cmpOp(other: Var<any>, op: Comparison): boolean {
        if (other instanceof VarString) return false;
        if (other instanceof VarLong) {
            switch (op) {
                case "Equal":
                    return other.value.eq(this.value);
                case "Less Than":
                    return other.value.gte(this.value);
                case "Less Than Or Equal":
                    return other.value.gt(this.value);
                case "Greater Than":
                    return other.value.lte(this.value);
                case "Greater Than Or Equal":
                    return other.value.lt(this.value);
            }
        }
        switch (op) {
            case "Equal":
                return this.value == other.value;
            case "Less Than":
                return this.value < other.value;
            case "Less Than Or Equal":
                return this.value <= other.value;
            case "Greater Than":
                return this.value > other.value;
            case "Greater Than Or Equal":
                return this.value >= other.value;
        }
    }

    shouldUnset(): boolean {
        return this.value === 0.0;
    }

    toLong(): Long {
        return Long.fromNumber(this.value);
    }

    toDouble(): number {
        return this.value;
    }

    toString(): string {
        return formatNumber(this.value.toFixed(4));
    }
}

export class VarString implements Var<string> {
    value: string;
    type = "string";

    constructor(value: string) {
        this.value = value;
    }

    binOp(other: Var<string>, op: Operation): Var<string> {
        if (op === "Set") {
            return other;
        }
        throw new Error("Not implemented");
    }
    cmpOp(other: Var<any>, op: Comparison): boolean {
        if (op === "Equal") {
            return this.value === other.value;
        }
        return false;
    }

    shouldUnset(): boolean {
        return this.value === "";
    }

    toLong(): Long {
        return Long.ZERO;
    }

    toDouble(): number {
        return 0;
    }

    toString(): string {
        return this.value;
    }
}

export type TeamVarKey = { team: string; key: string };

export class VarHolder<T> {
    private stats: Map<T, Var<any>>;

    constructor() {
        this.stats = new Map();
    }

    getVar(key: T, fallback: Var<any> = new VarString("")): Var<any> {
        return this.stats.get(key) ?? fallback;
    }

    setVar(key: T, value: Var<any>): void {
        this.stats.set(key, value);
    }

    unsetVar(key: T): void {
        this.stats.delete(key);
    }

    keys(): Set<T> {
        const set = new Set<T>();
        for (const key of this.stats.keys()) {
            set.add(key);
        }
        return set;
    }
}

const PLACEHOLDER_REGEX = /%([^%]+?)%/g;
const EXPLICIT_DOUBLE_REGEX = /^(0|[1-9]\d*)(\.\d+)$/;

/**
 * Parses a string literal, which may contain placeholders.
 * It resolves placeholders and performs type casting.
 *
 * @param value - The raw unquoted string
 */
function parseString(value: string): Var<any> {
    const placeholders = value.match(PLACEHOLDER_REGEX);

    if (!placeholders) {
        return new VarString(value);
    }

    let _value = value;
    for (const placeholder of placeholders) {
        const placeholderContent = placeholder.substring(1, placeholder.length - 1);
        try {
            const evaluatedVar = parsePlaceholder(placeholderContent);

            _value = _value.replace(placeholder, evaluatedVar.toString());
        } catch (error) {
            /* Ignore */
        }
    }

    // We do not use the replaced value if it is too long
    if (_value.length <= 32) {
        value = _value;
    }

    const lastChar = value.slice(-1).toUpperCase();
    if (lastChar !== "L" && lastChar !== "D") return new VarString(value);

    // We are now trying to cast
    const baseValue = value.slice(0, -1).replace(/,/g, "");

    if (
        // Number is a long within 64-bit integer limit
        isLong(baseValue) ||
        // Or number is a double (that has a decimal place)
        EXPLICIT_DOUBLE_REGEX.test(baseValue)
    ) {
        if (lastChar === "L") {
            const maybeTruncated = baseValue.split(".")[0];
            return VarLong.fromString(maybeTruncated);
        }

        if (lastChar === "D") {
            return VarDouble.fromString(baseValue);
        }
    }

    // Cast failed
    return new VarString(value);
}

/**
 * Parses a variable from a string.
 *
 * @throws An error when the value is invalid.
 */
export function parseValue(value: string): Var<any> {
    if (!value) {
        throw new Error("Input value cannot be null or empty.");
    }

    if (value.startsWith("%") && value.endsWith("%") && value.length > 2) {
        const content = value.substring(1, value.length - 1);
        return parsePlaceholder(content);
    }

    if (value.startsWith('"') && value.endsWith('"')) {
        const content = value.substring(1, value.length - 1);
        return parseString(content);
    }

    if (value.includes(".") && !isNaN(Number(value))) {
        return VarDouble.fromString(value);
    }

    if (/^-?\d+$/.test(value)) {
        return VarLong.fromString(value);
    }

    throw Error("Invalid value");
}
