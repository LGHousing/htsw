import { javaType } from "./utils/java";

const Paths = javaType("java.nio.file.Paths");
const URL = javaType("java.net.URL");
const URLClassLoader = javaType("java.net.URLClassLoader");
const ReflectArray = javaType("java.lang.reflect.Array");

const urls = ReflectArray.newInstance<HtswJavaUrl>(URL, 1);
urls[0] = Paths.get("./config/ChatTriggers/modules/HTSW").toUri().toURL();
const classLoader = new URLClassLoader(urls);

export function loadBundledJavaClass(name: "LongValue"): HtswLongValueClass;
export function loadBundledJavaClass(
    name: "HousingDecimalFormatter"
): HtswHousingDecimalFormatterClass;
export function loadBundledJavaClass(
    name: "LongValue" | "HousingDecimalFormatter"
): HtswLongValueClass | HtswHousingDecimalFormatterClass {
    return classLoader.loadClass(name);
}
