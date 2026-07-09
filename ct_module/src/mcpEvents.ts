import type { Importable } from "htsw/types";

const QUEUE_KEY = "htsw.mcp.eventQueue";
const MAX_QUEUE_SIZE = 500;

type JavaQueue = {
    add(value: string): boolean;
    poll(): string | null;
    size(): number;
};

type JavaProperties = {
    get(key: string): unknown;
    put(key: string, value: unknown): unknown;
    putIfAbsent?(key: string, value: unknown): unknown;
};

declare const Java: {
    type(name: string): unknown;
};

function eventQueue(): JavaQueue | null {
    try {
        const SystemClass = Java.type("java.lang.System") as {
            getProperties(): JavaProperties;
        };
        const props = SystemClass.getProperties();
        const existing = props.get(QUEUE_KEY);
        if (existing !== null && existing !== undefined) return existing as JavaQueue;
        const QueueClass = Java.type("java.util.concurrent.ConcurrentLinkedQueue") as {
            new (): JavaQueue;
        };
        const queue = new QueueClass();
        const previous = props.putIfAbsent === undefined
            ? props.put(QUEUE_KEY, queue)
            : props.putIfAbsent(QUEUE_KEY, queue);
        return previous === null || previous === undefined ? queue : (previous as JavaQueue);
    } catch (_e) {
        return null;
    }
}

export function publishMcpEvent(payload: Record<string, unknown>): void {
    try {
        const queue = eventQueue();
        if (queue === null) return;
        while (queue.size() >= MAX_QUEUE_SIZE) queue.poll();
        queue.add(JSON.stringify({ ...payload, ts: Date.now() }));
    } catch (_e) {
        // Best-effort cross-module bridge: importer behavior must never depend on it.
    }
}

export function publishMcpImportableEvent(args: {
    key: string;
    importableType: Importable["type"] | null;
    status: "imported" | "skipped" | "failed";
    error?: string;
}): void {
    publishMcpEvent({
        type: "htsw_importable",
        key: args.key,
        importableType: args.importableType,
        status: args.status,
        ...(args.error === undefined ? {} : { error: args.error }),
    });
}
