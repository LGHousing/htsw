import { javaType } from "../utils/java";

const BYTES_PER_MB = 1024 * 1024;

export function commandHeap(args: string[]): void {
    try {
        if (args.length === 0) {
            printHeapSummary();
            return;
        }

        if (args[0].toLowerCase() !== "dump") {
            ChatLib.chat("&c[heap] Usage: /htsw debug heap [dump [live|all]]");
            return;
        }

        const mode = args.length > 1 ? args[1].toLowerCase() : "live";
        if (args.length > 2 || (mode !== "live" && mode !== "all")) {
            ChatLib.chat("&c[heap] Usage: /htsw debug heap dump [live|all]");
            return;
        }
        dumpHeap(mode !== "all");
    } catch (e) {
        ChatLib.chat(`&c[heap] ${String(e)}`);
    }
}

function printHeapSummary(): void {
    const runtime = javaType("java.lang.Runtime").getRuntime();
    const committed = Number(runtime.totalMemory());
    const free = Number(runtime.freeMemory());
    const used = committed - free;
    const max = Number(runtime.maxMemory());
    ChatLib.chat(
        `&7[heap] used &f${mb(used)} MB&7 / committed &f${mb(committed)} MB&7 / max &f${mb(max)} MB`
    );

    const beans = javaType(
        "java.lang.management.ManagementFactory"
    ).getGarbageCollectorMXBeans();
    for (let i = 0; i < beans.size(); i++) {
        const bean = beans.get(i);
        ChatLib.chat(
            `&7[heap] GC &f${String(bean.getName())}&7: ` +
                `&f${Number(bean.getCollectionCount())}&7 collections, ` +
                `&f${Number(bean.getCollectionTime())} ms&7 total`
        );
    }
}

function dumpHeap(live: boolean): void {
    const File = javaType("java.io.File");
    const file = new File(`./htsw/htsw-heap-${Date.now()}.hprof`);
    const parent = file.getParentFile();
    if (parent !== null) parent.mkdirs();
    const path = String(file.getAbsolutePath());

    ChatLib.chat(
        `&7[heap] Writing ${live ? "live-object" : "all-object"} heap dump. ` +
            "&fThe game may pause for a few seconds."
    );

    const ManagementFactory = javaType("java.lang.management.ManagementFactory");
    const ObjectName = javaType("javax.management.ObjectName");
    ManagementFactory.getPlatformMBeanServer().invoke(
        new ObjectName("com.sun.management:type=HotSpotDiagnostic"),
        "dumpHeap",
        Java.to([path, live], "java.lang.Object[]"),
        Java.to(["java.lang.String", "boolean"], "java.lang.String[]")
    );

    ChatLib.chat(`&a[heap] wrote &f${path} &7(${mb(Number(file.length()))} MB)`);
}

function mb(bytes: number): string {
    return (bytes / BYTES_PER_MB).toFixed(1);
}
