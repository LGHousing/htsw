import { Comparison, Operation } from "housing-common";
import Long from "long";
import { parsePlaceholder } from "./placeholders";
import { formatNumber } from "./helpers";

export interface Var<T> {
    value: T;
    type: string;

    binOp(other: Var<T>, op: Operation): Var<T>;
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
        return new VarLong(Long.fromString(string));
    }

    static fromNumber(number: number): VarLong {
        return new VarLong(Long.fromNumber(number));
    }

    binOp(other: Var<Long>, op: Operation): Var<Long> {
        switch (op) {
            case "set":
                return other;
            case "increment":
                return new VarLong(this.value.add(other.value));
            case "decrement":
                return new VarLong(this.value.sub(other.value));
            case "multiply":
                return new VarLong(this.value.mul(other.value));
            case "divide":
                return new VarLong(this.value.div(other.value));
        }
    }

    cmpOp(other: Var<any>, op: Comparison): boolean {
        switch (op) {
            case "less_than":
                return this.value.lt(other.value);
            case "less_than_or_equals":
                return this.value.lte(other.value);
            case "equals":
                return this.value.eq(other.value);
            case "greater_than":
                return this.value.gt(other.value);
            case "greater_than_or_equals":
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

    binOp(other: Var<number>, op: Operation): Var<number> {
        switch (op) {
            case "set":
                return other;
            case "increment":
                return new VarDouble(this.value + other.value);
            case "decrement":
                return new VarDouble(this.value - other.value);
            case "multiply":
                return new VarDouble(this.value * other.value);
            case "divide":
                return new VarDouble(this.value / other.value);
        }
    }

    cmpOp(other: Var<any>, op: Comparison): boolean {
        if (other instanceof VarString) return false;
        if (other instanceof VarLong) {
            switch (op) {
                case "less_than":
                    return other.value.gte(this.value);
                case "less_than_or_equals":
                    return other.value.gt(this.value);
                case "equals":
                    return other.value.eq(this.value);
                case "greater_than":
                    return other.value.lte(this.value);
                case "greater_than_or_equals":
                    return other.value.lt(this.value);
            }
        }
        switch (op) {
            case "less_than":
                return this.value < other.value;
            case "less_than_or_equals":
                return this.value <= other.value;
            case "equals":
                return this.value == other.value;
            case "greater_than":
                return this.value > other.value;
            case "greater_than_or_equals":
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
        return formatNumber(this.value.toFixed(20));
    }
}

export class VarString implements Var<string> {
    value: string;
    type = "string";

    constructor(value: string) {
        this.value = value;
    }

    binOp(other: Var<string>, op: Operation): Var<string> {
        if (op === "set") {
            return other;
        }
        throw new Error("Method not implemented.");
    }
    cmpOp(other: Var<any>, op: Comparison): boolean {
        if (op === "equals") {
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

    for (const placeholder of placeholders) {
        const placeholderContent = placeholder.substring(1, placeholder.length - 1);
        try {
            const evaluatedVar = parsePlaceholder(placeholderContent);

            value = value.replace(placeholder, evaluatedVar.toString());
        } catch (error) {
            /* Ignore */
        }
    }

    const lastChar = value.slice(-1).toUpperCase();
    const baseValue = value.slice(0, -1);

    if (/^\d+L?$/.test(baseValue) || (lastChar === "L" && !isNaN(Number(baseValue)))) {
        return VarLong.fromString(baseValue);
    }

    if (!isNaN(Number(baseValue)) || (lastChar === "D" && !isNaN(Number(baseValue)))) {
        return VarDouble.fromString(baseValue);
    }

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
