import { javaType } from "../utils/java";

const BYTES_PER_MB = 1024 * 1024;

export function commandHeap(args: string[]): void {
    try {
        if (args.length === 0) {
            printHeapSummary();
            return;
        }

        if (args[0].toLowerCase() === "gc") {
            if (args.length > 1) {
                ChatLib.chat(
                    "&c[heap] Usage: /htsw debug heap [gc|dump [live|all]]"
                );
                return;
            }
            requestFullGc();
            return;
        }

        if (args[0].toLowerCase() !== "dump") {
            ChatLib.chat("&c[heap] Usage: /htsw debug heap [gc|dump [live|all]]");
            return;
        }

        const mode = args.length > 1 ? args[1].toLowerCase() : "live";
        if (args.length > 2 || (mode !== "live" && mode !== "all")) {
            ChatLib.chat(
                "&c[heap] Usage: /htsw debug heap [gc|dump [live|all]]"
            );
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
        `&7[heap] Java heap used &f${mb(used)} MB&7 / committed &f${mb(committed)} MB&7 / limit &f${mb(max)} MB`
    );

    const ManagementFactory = javaType("java.lang.management.ManagementFactory");
    const nonHeap = ManagementFactory.getMemoryMXBean().getNonHeapMemoryUsage();
    ChatLib.chat(
        `&7[heap] JVM non-heap used &f${mb(Number(nonHeap.getUsed()))} MB&7 / committed &f${mb(Number(nonHeap.getCommitted()))} MB`
    );
    ChatLib.chat(
        "&7[heap] Activity Monitor also counts native, graphics, mapped, and compressed memory outside the Java heap limit."
    );

    const beans = ManagementFactory.getGarbageCollectorMXBeans();
    for (let i = 0; i < beans.length; i++) {
        const bean = beans[i];
        ChatLib.chat(
            `&7[heap] GC &f${String(bean.getName())}&7: ` +
                `&f${Number(bean.getCollectionCount())}&7 collections, ` +
                `&f${Number(bean.getCollectionTime())} ms&7 total`
        );
    }
}

function requestFullGc(): void {
    const beforeUsed = heapUsed();
    const beforeOldCollections = g1OldGenerationCollectionCount();
    ChatLib.chat(
        `&7[heap] Before GC request: used &f${mb(beforeUsed)} MB&7; ` +
            `G1 Old Generation collections &f${collectionCount(beforeOldCollections)}`
    );

    const System = javaType("java.lang.System") as HtswJavaSystemClass & {
        gc(): void;
    };
    System.gc();

    const afterUsed = heapUsed();
    const afterOldCollections = g1OldGenerationCollectionCount();
    ChatLib.chat(
        `&7[heap] After GC request: used &f${mb(afterUsed)} MB&7 ` +
            `(delta &f${signedMb(afterUsed - beforeUsed)} MB&7); ` +
            `G1 Old Generation collections &f${collectionCount(beforeOldCollections)}` +
            `&7 -> &f${collectionCount(afterOldCollections)}&7 ` +
            `(${oldGenerationCollectionResult(beforeOldCollections, afterOldCollections)})`
    );
}

function heapUsed(): number {
    const runtime = javaType("java.lang.Runtime").getRuntime();
    return Number(runtime.totalMemory()) - Number(runtime.freeMemory());
}

function g1OldGenerationCollectionCount(): number | null {
    const ManagementFactory = javaType("java.lang.management.ManagementFactory");
    const beans = ManagementFactory.getGarbageCollectorMXBeans();
    for (let i = 0; i < beans.length; i++) {
        if (String(beans[i].getName()) === "G1 Old Generation") {
            return Number(beans[i].getCollectionCount());
        }
    }
    return null;
}

function collectionCount(count: number | null): string {
    return count === null ? "unavailable" : String(count);
}

function oldGenerationCollectionResult(before: number | null, after: number | null): string {
    if (before === null || after === null) {
        return "old-generation collector unavailable";
    }
    return after > before
        ? "old-generation collection observed"
        : "no old-generation collection observed";
}

function signedMb(bytes: number): string {
    const value = bytes / BYTES_PER_MB;
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
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
    const HotSpotDiagnosticMXBean = javaType(
        "com.sun.management.HotSpotDiagnosticMXBean"
    );
    const diagnostic = ManagementFactory.getPlatformMXBean(HotSpotDiagnosticMXBean);
    diagnostic.dumpHeap(path, live);

    ChatLib.chat(`&a[heap] wrote &f${path} &7(${mb(Number(file.length()))} MB)`);
}

function mb(bytes: number): string {
    return (bytes / BYTES_PER_MB).toFixed(1);
}
