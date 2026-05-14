import type { Comparison, Operation, VarOperation } from "../types";
import type { Runtime } from "./runtime";

import { Long } from "../long";

export interface Var<T> {
    value: T;
    type: string;

    binOp(other: Var<T>, op: VarOperation): Var<T>;
    cmpOp(other: Var<any>, op: Comparison): boolean;

    shouldUnset(): boolean;
    unsetValue(): Var<T>;

    toLong(): Long;
    toDouble(): number;
    toString(): string;

    toDisplayString(): string;
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
                return new VarLong(this.value.shl(other.value));
            case "Shift Right":
                return new VarLong(this.value.shr(other.value));
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
            case "Less Than or Equal":
                return this.value.lte(other.value);
            case "Greater Than":
                return this.value.gt(other.value);
            case "Greater Than or Equal":
                return this.value.gte(other.value);
        }
    }

    shouldUnset(): boolean {
        return this.value.eq(Long.ZERO);
    }

    unsetValue(): Var<Long> {
        return new VarLong(Long.ZERO);
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

    toDisplayString(): string {
        return this.toString();
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
                case "Less Than or Equal":
                    return other.value.gt(this.value);
                case "Greater Than":
                    return other.value.lte(this.value);
                case "Greater Than or Equal":
                    return other.value.lt(this.value);
            }
        }
        switch (op) {
            case "Equal":
                return this.value == other.value;
            case "Less Than":
                return this.value < other.value;
            case "Less Than or Equal":
                return this.value <= other.value;
            case "Greater Than":
                return this.value > other.value;
            case "Greater Than or Equal":
                return this.value >= other.value;
        }
    }

    shouldUnset(): boolean {
        return this.value === 0.0;
    }

    unsetValue(): Var<number> {
        return new VarDouble(0.0);
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

    toDisplayString(): string {
        return this.toString();
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

    unsetValue(): Var<string> {
        return new VarString("");
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

    toDisplayString(): string {
        return `"${this.value}"`;
    }
}

const PLACEHOLDER_REGEX = /%([^%]+?)%/g;
const EXPLICIT_DOUBLE_REGEX = /^(0|[1-9]\d*)(\.\d+)$/;

function parseString(runtime: Runtime, value: string): Var<any> {
    const placeholders = value.match(PLACEHOLDER_REGEX);

    if (!placeholders) {
        return new VarString(value);
    }

    let _value = value;
    for (const placeholder of placeholders) {
        const placeholderContent = placeholder.substring(1, placeholder.length - 1);
        try {
            const evaluatedVar = runtime.runPlaceholder(placeholderContent);
            if (evaluatedVar === undefined) throw new Error("Unresolved placeholder");

            _value = _value.replace(placeholder, evaluatedVar.toString());
        } catch (error) {
            /* Ignore */
        }
    }

    // We do not use the replaced value if it is too long
    if (_value.length <= 32) {
        value = _value;
    }

    if (isLong(value)) {
        return VarLong.fromString(value);
    } else if (EXPLICIT_DOUBLE_REGEX.test(value)) {
        return VarDouble.fromString(value);
    }

    const lastChar = value.slice(-1).toUpperCase();
    if (lastChar !== "L" && lastChar !== "D") return new VarString(value);

    const baseValue = value.slice(0, -1).replace(/,/g, "");
    if (isLong(baseValue) || EXPLICIT_DOUBLE_REGEX.test(baseValue)) {
        if (lastChar === "L") {
            const maybeTruncated = baseValue.split(".")[0];
            return VarLong.fromString(maybeTruncated);
        }

        if (lastChar === "D") {
            return VarDouble.fromString(baseValue);
        }
    }

    return new VarString(value);
}

export function parseValue(runtime: Runtime, value: string): Var<any> {
    if (!value) {
        throw new Error("Input value cannot be null or empty.");
    }

    if (value.startsWith("%") && value.endsWith("%") && value.length > 2) {
        const content = value.substring(1, value.length - 1);
        let resolved = runtime.runPlaceholder(content);
        if (!resolved) {
            throw new Error(`Placeholder "${content}" could not be resolved.`);
        }
        if (resolved instanceof VarString) {
            resolved = parseString(runtime, resolved.value);
        }
        return resolved;
    }

    if (value.startsWith('"') && value.endsWith('"')) {
        const content = value.substring(1, value.length - 1);
        return parseString(runtime, content);
    }

    if (value.includes(".") && !isNaN(Number(value))) {
        return VarDouble.fromString(value);
    }

    if (/^-?\d+$/.test(value)) {
        return VarLong.fromString(value);
    }

    throw Error("Invalid value");
}

export function formatNumber(number: string): string {
    const [whole, decimal = ""] = number.split(".");

    let formattedWhole = "";
    for (let i = whole.length - 1, count = 0; i >= 0; i--, count++) {
        formattedWhole = whole[i] + formattedWhole;
        if (count === 2 && i !== 0) {
            formattedWhole = "," + formattedWhole;
            count = -1;
        }
    }

    if (!decimal) return formattedWhole;

    let roundedDecimal = Math.floor((+(decimal + "0000").slice(0, 4) + 5) / 10).toString();
    while (roundedDecimal.length < 3) roundedDecimal = "0" + roundedDecimal;

    return formattedWhole + "." + roundedDecimal.replace(/0+$/, "");
}

export function isLong(value: string): boolean {
    return value == Long.fromString(value).toString();
}

export function parseLong(value: string): Long {
    const long = Long.fromString(value);

    if (value !== long.toString()) {
        return value.startsWith("-")
            ? Long.fromString("9223372036854775807")
            : Long.fromString("-9223372036854775808");
    } else {
        return long;
    }
}
