import JsLong from "long";

type LongImplValue = any;

export interface LongImpl {
    fromString(s: string): LongImplValue;
    fromNumber(n: number): LongImplValue;
    fromBits(low: number, high: number): LongImplValue;

    toString(v: LongImplValue): string;
    toNumber(v: LongImplValue): number;
    high(v: LongImplValue): number;
    low(v: LongImplValue): number;

    add(a: LongImplValue, b: LongImplValue): LongImplValue;
    sub(a: LongImplValue, b: LongImplValue): LongImplValue;
    mul(a: LongImplValue, b: LongImplValue): LongImplValue;
    div(a: LongImplValue, b: LongImplValue): LongImplValue;
    mod(a: LongImplValue, b: LongImplValue): LongImplValue;

    shl(a: LongImplValue, bits: number): LongImplValue;
    shr(a: LongImplValue, bits: number): LongImplValue;
    shru(a: LongImplValue, bits: number): LongImplValue;

    and(a: LongImplValue, b: LongImplValue): LongImplValue;
    or(a: LongImplValue, b: LongImplValue): LongImplValue;
    xor(a: LongImplValue, b: LongImplValue): LongImplValue;

    eq(a: LongImplValue, b: LongImplValue): boolean;
    gt(a: LongImplValue, b: LongImplValue): boolean;
    lt(a: LongImplValue, b: LongImplValue): boolean;

    zero(): LongImplValue;
}

const jsLongImpl: LongImpl = {
    fromString: (s) => JsLong.fromString(s),
    fromNumber: (n) => JsLong.fromNumber(n),
    fromBits: (low, high) => JsLong.fromBits(low, high),

    toString: (v) => (v as JsLong).toString(),
    toNumber: (v) => (v as JsLong).toNumber(),
    high: (v) => (v as JsLong).high,
    low: (v) => (v as JsLong).low,

    add: (a, b) => (a as JsLong).add(b as JsLong),
    sub: (a, b) => (a as JsLong).sub(b as JsLong),
    mul: (a, b) => (a as JsLong).mul(b as JsLong),
    div: (a, b) => (a as JsLong).div(b as JsLong),
    mod: (a, b) => (a as JsLong).mod(b as JsLong),

    shl: (a, bits) => (a as JsLong).shl(bits),
    shr: (a, bits) => (a as JsLong).shr(bits),
    shru: (a, bits) => (a as JsLong).shru(bits),

    and: (a, b) => (a as JsLong).and(b as JsLong),
    or: (a, b) => (a as JsLong).or(b as JsLong),
    xor: (a, b) => (a as JsLong).xor(b as JsLong),

    eq: (a, b) => (a as JsLong).eq(b as JsLong),
    gt: (a, b) => (a as JsLong).gt(b as JsLong),
    lt: (a, b) => (a as JsLong).lt(b as JsLong),

    zero: () => JsLong.ZERO,
};

let longImpl: LongImpl = jsLongImpl;

export class Long {
    private static readonly MIN_VALUE_STRING = "-9223372036854775808";
    private static readonly MAX_VALUE_STRING = "9223372036854775807";

    private readonly value: LongImplValue;

    private constructor(value: LongImplValue) {
        this.value = value;
    }

    static fromString(value: string): Long {
        return new Long(longImpl.fromString(value));
    }

    static fromNumber(value: number): Long {
        return new Long(longImpl.fromNumber(value));
    }

    static fromBits(low: number, high: number): Long {
        return new Long(longImpl.fromBits(low, high));
    }

    static get ZERO(): Long {
        return new Long(longImpl.zero());
    }

    static get MIN_VALUE(): Long {
        return Long.fromString(Long.MIN_VALUE_STRING);
    }

    static get MAX_VALUE(): Long {
        return Long.fromString(Long.MAX_VALUE_STRING);
    }

    toString(): string {
        return longImpl.toString(this.value);
    }

    toNumber(): number {
        return longImpl.toNumber(this.value);
    }

    get high(): number {
        return longImpl.high(this.value);
    }

    get low(): number {
        return longImpl.low(this.value);
    }

    private static coerce(value: Long | number): Long {
        return typeof value === "number" ? Long.fromNumber(value) : value;
    }

    add(other: Long | number): Long {
        const rhs = Long.coerce(other);
        return new Long(longImpl.add(this.value, rhs.value));
    }

    sub(other: Long | number): Long {
        const rhs = Long.coerce(other);
        return new Long(longImpl.sub(this.value, rhs.value));
    }

    mul(other: Long | number): Long {
        const rhs = Long.coerce(other);
        return new Long(longImpl.mul(this.value, rhs.value));
    }

    div(other: Long | number): Long {
        const rhs = Long.coerce(other);
        return new Long(longImpl.div(this.value, rhs.value));
    }

    mod(other: Long | number): Long {
        const rhs = Long.coerce(other);
        return new Long(longImpl.mod(this.value, rhs.value));
    }

    shl(bits: number | Long): Long {
        const shift = typeof bits === "number" ? bits : bits.toNumber();
        return new Long(longImpl.shl(this.value, shift));
    }

    shr(bits: number | Long): Long {
        const shift = typeof bits === "number" ? bits : bits.toNumber();
        return new Long(longImpl.shr(this.value, shift));
    }

    shru(bits: number | Long): Long {
        const shift = typeof bits === "number" ? bits : bits.toNumber();
        return new Long(longImpl.shru(this.value, shift));
    }

    and(other: Long | number): Long {
        const rhs = Long.coerce(other);
        return new Long(longImpl.and(this.value, rhs.value));
    }

    or(other: Long | number): Long {
        const rhs = Long.coerce(other);
        return new Long(longImpl.or(this.value, rhs.value));
    }

    xor(other: Long | number): Long {
        const rhs = Long.coerce(other);
        return new Long(longImpl.xor(this.value, rhs.value));
    }

    eq(other: Long | number): boolean {
        const rhs = Long.coerce(other);
        return longImpl.eq(this.value, rhs.value);
    }

    gt(other: Long | number): boolean {
        const rhs = Long.coerce(other);
        return longImpl.gt(this.value, rhs.value);
    }

    lt(other: Long | number): boolean {
        const rhs = Long.coerce(other);
        return longImpl.lt(this.value, rhs.value);
    }

    lte(other: Long | number): boolean {
        return !this.gt(other);
    }

    gte(other: Long | number): boolean {
        return !this.lt(other);
    }

    isZero(): boolean {
        return this.eq(0);
    }

    isNegative(): boolean {
        return this.lt(0);
    }
}

export function setLongImplementation(impl: LongImpl): void {
    longImpl = impl;
}
