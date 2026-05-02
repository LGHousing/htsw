import * as htsw from "htsw";

const Paths = Java.type("java.nio.file.Paths");
const URL = Java.type("java.net.URL");
const URLClassLoader = Java.type("java.net.URLClassLoader");
const Array = Java.type("java.lang.reflect.Array");
const JString = Java.type("java.lang.String");
const JDouble = Java.type("java.lang.Double");
const JInteger = Java.type("java.lang.Integer");

const urls = Array.newInstance(URL, 1);
urls[0] = Paths.get("./config/ChatTriggers/modules/HTSW").toUri().toURL();
const classLoader = new URLClassLoader(urls);
const longClass = classLoader.loadClass("LongValue");

const mFromString = longClass.getMethod("fromString", JString);
const mFromNumber = longClass.getMethod("fromNumber", JDouble.TYPE);
const mFromBits = longClass.getMethod("fromBits", JInteger.TYPE, JInteger.TYPE);
const mZero = longClass.getMethod("zero");

htsw.setLongImplementation({
    fromString: (s) => mFromString.invoke(null, s),
    fromNumber: (n) => mFromNumber.invoke(null, n),
    fromBits: (low, high) => mFromBits.invoke(null, low, high),

    toString: (v) => v.toString(),
    toNumber: (v) => v.toNumber(),

    high: (v) => v.high(),
    low: (v) => v.low(),

    add: (a, b) => a.add(b),
    sub: (a, b) => a.sub(b),
    mul: (a, b) => a.mul(b),
    div: (a, b) => a.div(b),
    mod: (a, b) => a.mod(b),

    shl: (a, bits) => a.shl(bits),
    shr: (a, bits) => a.shr(bits),
    shru: (a, bits) => a.shru(bits),

    and: (a, b) => a.and(b),
    or: (a, b) => a.or(b),
    xor: (a, b) => a.xor(b),

    eq: (a, b) => a.eq(b),
    gt: (a, b) => a.gt(b),
    lt: (a, b) => a.lt(b),

    zero: () => mZero.invoke(null),
});
