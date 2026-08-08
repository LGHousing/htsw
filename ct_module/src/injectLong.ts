import * as htsw from "htsw";
import { loadBundledJavaClass } from "./bundledJava";
import { javaType } from "./utils/java";

const JString = javaType("java.lang.String");
const JDouble = javaType("java.lang.Double");
const JInteger = javaType("java.lang.Integer");

const longClass = loadBundledJavaClass("LongValue");

const mFromString = longClass.getMethod("fromString", JString);
const mFromNumber = longClass.getMethod("fromNumber", JDouble.TYPE);
const mFromBits = longClass.getMethod("fromBits", JInteger.TYPE, JInteger.TYPE);
const mZero = longClass.getMethod("zero");

htsw.setLongImplementation({
    fromString: (s) => mFromString.invoke(null, s),
    fromNumber: (n) => mFromNumber.invoke(null, n),
    fromBits: (low, high) => mFromBits.invoke(null, low, high),

    toString: (v: HtswLongValue) => v.toString(),
    toNumber: (v: HtswLongValue) => v.toNumber(),

    high: (v: HtswLongValue) => v.high(),
    low: (v: HtswLongValue) => v.low(),

    add: (a: HtswLongValue, b: HtswLongValue) => a.add(b),
    sub: (a: HtswLongValue, b: HtswLongValue) => a.sub(b),
    mul: (a: HtswLongValue, b: HtswLongValue) => a.mul(b),
    div: (a: HtswLongValue, b: HtswLongValue) => a.div(b),
    mod: (a: HtswLongValue, b: HtswLongValue) => a.mod(b),

    shl: (a: HtswLongValue, bits) => a.shl(bits),
    shr: (a: HtswLongValue, bits) => a.shr(bits),
    shru: (a: HtswLongValue, bits) => a.shru(bits),

    and: (a: HtswLongValue, b: HtswLongValue) => a.and(b),
    or: (a: HtswLongValue, b: HtswLongValue) => a.or(b),
    xor: (a: HtswLongValue, b: HtswLongValue) => a.xor(b),

    eq: (a: HtswLongValue, b: HtswLongValue) => a.eq(b),
    gt: (a: HtswLongValue, b: HtswLongValue) => a.gt(b),
    lt: (a: HtswLongValue, b: HtswLongValue) => a.lt(b),

    zero: () => mZero.invoke(null),
});
