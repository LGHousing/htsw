import { loadBundledJavaClass } from "./bundledJava";
import { setHousingDecimalQuantizer } from "./housingSync/actions/comparison";
import { javaType } from "./utils/java";

const JDouble = javaType("java.lang.Double");
const formatterClass = loadBundledJavaClass("HousingDecimalFormatter");
const quantize = formatterClass.getMethod("quantize", JDouble.TYPE);

setHousingDecimalQuantizer((value) => quantize.invoke(null, value));
