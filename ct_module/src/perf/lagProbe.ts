/// <reference types="../../CTAutocomplete" />

import { normalizePathSeparators } from "htsw-editor-common/project";
import { getTaskProgress } from "../gui/right-panel/import-tab/taskProgress";
import { getParsePerfStats } from "../gui/parsing/parses";
import { debugLog, debugLogError, flushGuiDebug } from "../gui/lib/debugLog";
import { TaskManager } from "../tasks/manager";
import { getEventContainerCounts } from "../tasks/specifics/waitFor";

type RhinoString = string | { toString(): string };

interface RhinoAtomicBoolean {
    compareAndSet(expected: boolean, next: boolean): boolean;
    get(): unknown;
    set(value: boolean): void;
}

interface RhinoAtomicBooleanClass {
    new (initial: boolean): RhinoAtomicBoolean;
}

interface RhinoGcBean {
    getCollectionCount(): unknown;
    getCollectionTime(): unknown;
}

interface RhinoGcBeanArray {
    readonly length: number;
    [index: number]: RhinoGcBean;
}

interface RhinoRuntime {
    freeMemory(): unknown;
    totalMemory(): unknown;
}

interface RhinoStackTraceElement {
    toString(): RhinoString;
}

interface RhinoThread {
    getStackTrace(): { readonly length: unknown; [index: number]: RhinoStackTraceElement };
    interrupt(): void;
    setDaemon(daemon: boolean): void;
    start(): void;
}

interface RhinoThreadClass {
    new (run: () => void, name: string): RhinoThread;
    currentThread(): RhinoThread;
    sleep(milliseconds: number): void;
}

interface RhinoQueue<T> {
    add(value: T): boolean;
    poll(): T | null;
}

interface RhinoQueueClass {
    new <T = string>(): RhinoQueue<T>;
}

interface RhinoJavaPackages {
    lang: {
        Thread: RhinoThreadClass;
        Runtime: { getRuntime(): RhinoRuntime };
        management: {
            ManagementFactory: {
                getGarbageCollectorMXBeans(): RhinoGcBeanArray;
            };
        };
    };
    util: {
        concurrent: {
            ConcurrentLinkedQueue: RhinoQueueClass;
            atomic: { AtomicBoolean: RhinoAtomicBooleanClass };
        };
    };
}

declare const java: RhinoJavaPackages;

type WaiterCounts = {
    [k: string]: number;
};

type LagSample = {
    at: number;
    gapMs: number;
    /** GC collections / GC milliseconds that happened inside this gap —
     *  attributes the stall to the collector vs. our own code. */
    gcCount: number;
    gcMs: number;
    /** Heap used at the step before the gap vs. right after it — a large
     *  drop across the gap is a collection even if the beans are unreadable. */
    heapBeforeMB: number;
    heapAfterMB: number;
    screen: string;
    importing: boolean;
    taskRunning: boolean;
    waiters: WaiterCounts;
    lastParse: string;
};

const STALL_MS = 250;
const MAX_SAMPLES = 16;
const probeEnabled = new java.util.concurrent.atomic.AtomicBoolean(false);
const watchdogRunning = new java.util.concurrent.atomic.AtomicBoolean(false);

let lastStepAt = Date.now();
const samples: LagSample[] = [];

// JVM-wide GC totals via the management beans, sampled every step so a
// stall's delta covers exactly that gap. Bean list fetched once (the
// getters themselves are plain counter reads). Reached through Rhino's bare
// `java` package global — the same route `images.ts` uses — because
// `Java.type` lookups of some platform classes have failed in this CT build.
let gcBeans: RhinoGcBeanArray | null = null;
let gcFailures = 0;
let lastGcCount = 0;
let lastGcMs = 0;

function gcTotals(): { count: number; ms: number } | null {
    if (gcFailures >= 3) return null;
    try {
        if (gcBeans === null) {
            gcBeans = java.lang.management.ManagementFactory
                .getGarbageCollectorMXBeans();
        }
        let count = 0;
        let ms = 0;
        const n = gcBeans.length;
        for (let i = 0; i < n; i++) {
            const b = gcBeans[i];
            count += Number(b.getCollectionCount());
            ms += Number(b.getCollectionTime());
        }
        return { count, ms };
    } catch (e) {
        gcBeans = null;
        gcFailures++;
        debugLogError("lagProbe.gcTotals", e);
        return null;
    }
}

let lastHeapUsedMB = -1;

function heapUsedMB(): number {
    try {
        const rt = java.lang.Runtime.getRuntime();
        return Math.round((Number(rt.totalMemory()) - Number(rt.freeMemory())) / 1048576);
    } catch (_e) {
        return -1;
    }
}

function screenName(): string {
    try {
        const screen = (
            Client as unknown as {
                getMinecraft(): {
                field_71462_r: {
                    getClass(): { getName(): RhinoString };
                } | null;
                };
            }
        ).getMinecraft().field_71462_r;
        if (screen === null) return "none";
        const name = String(screen.getClass().getName());
        const dot = name.lastIndexOf(".");
        return dot >= 0 ? name.substring(dot + 1) : name;
    } catch (_e) {
        return "unknown";
    }
}

function shortPath(path: string): string {
    const norm = normalizePathSeparators(path);
    const parts = norm.split("/").filter((p) => p.length > 0);
    if (parts.length <= 3) return norm;
    return ".../" + parts.slice(parts.length - 3).join("/");
}

function lastParseSummary(): string {
    const parses = getParsePerfStats();
    if (parses.length === 0) return "none";
    const p = parses[parses.length - 1];
    const age = Math.max(0, Math.round((Date.now() - p.at) / 1000));
    return `${p.source} ${p.ms}ms ${age}s ago ${shortPath(p.path)}`;
}

function record(
    gapMs: number,
    gcCount: number,
    gcMs: number,
    heapBeforeMB: number,
    heapAfterMB: number
): void {
    samples.push({
        at: Date.now(),
        gapMs,
        gcCount,
        gcMs,
        heapBeforeMB,
        heapAfterMB,
        screen: screenName(),
        importing: getTaskProgress() !== null,
        taskRunning: TaskManager.isBusy(),
        waiters: getEventContainerCounts(),
        lastParse: lastParseSummary(),
    });
    if (samples.length > MAX_SAMPLES) samples.shift();
}

// ── Mid-stall stack capture ──────────────────────────────────────────────
// A daemon watchdog polls the step heartbeat; when the client thread has
// been silent past STALL_MS it snapshots that thread's Java stack — i.e.
// what the stall is actually executing. One capture per stall. Captures
// ride a ConcurrentLinkedQueue (the source.ts cross-thread pattern) and
// drain on the client thread into `stallStacks` + gui-debug.log.
const MAX_STACKS = 6;
const stallStacks: string[][] = [];
let clientThread: RhinoThread | null = null;
let stackQueue: RhinoQueue<RhinoString> | null = null;
let watchdogThread: RhinoThread | null = null;

function startWatchdog(): void {
    if (!watchdogRunning.compareAndSet(false, true)) return;
    try {
        const ConcurrentLinkedQueue = java.util.concurrent.ConcurrentLinkedQueue;
        if (stackQueue === null) stackQueue = new ConcurrentLinkedQueue();
        const queue = stackQueue;
        const observedClientThread = clientThread;
        if (observedClientThread === null) {
            watchdogRunning.set(false);
            return;
        }
        let capturedForStepAt = 0;
        let capturesThisStall = 0;
        const t = new java.lang.Thread(function () {
            try {
                while (Boolean(probeEnabled.get())) {
                    try {
                        java.lang.Thread.sleep(60);
                        if (!Boolean(probeEnabled.get())) break;
                        const stalledSince = lastStepAt;
                        const stalledForMs = Date.now() - stalledSince;
                        if (stalledForMs < STALL_MS) continue;
                        if (capturedForStepAt !== stalledSince) {
                            capturedForStepAt = stalledSince;
                            capturesThisStall = 0;
                        }
                        // Snapshot the start of the stall, then again each further
                        // ~300ms of the same stall — long stalls get phase samples.
                        if (stalledForMs < STALL_MS + 300 * capturesThisStall) continue;
                        capturesThisStall++;
                        const trace = observedClientThread.getStackTrace();
                        const lines: string[] = [`stack ${stalledForMs}ms into stall:`];
                        const n = Math.min(Number(trace.length), 30);
                        for (let i = 0; i < n; i++) lines.push(String(trace[i].toString()));
                        queue.add(lines.join("\n"));
                    } catch (_e) {
                        // never let the watchdog die; next loop retries
                    }
                }
            } finally {
                watchdogThread = null;
                watchdogRunning.set(false);
            }
        }, "htsw-lagprobe-watchdog");
        watchdogThread = t;
        t.setDaemon(true);
        t.start();
    } catch (e) {
        watchdogThread = null;
        watchdogRunning.set(false);
        debugLogError("lagProbe.startWatchdog", e);
    }
}

function stopWatchdog(): void {
    probeEnabled.set(false);
    const thread = watchdogThread;
    if (thread !== null) {
        try {
            thread.interrupt();
        } catch (_e) {}
    }
}

function drainStallStacks(): void {
    if (stackQueue === null) return;
    for (;;) {
        const item = stackQueue.poll();
        if (item === null) break;
        const lines = String(item).split("\n");
        stallStacks.push(lines);
        if (stallStacks.length > MAX_STACKS) stallStacks.shift();
        debugLog(`[lagprobe] ${lines.join(" | ")}`);
        flushGuiDebug();
    }
}

const probeStepTrigger = register("step", () => {
    const now = Date.now();
    const gap = now - lastStepAt;
    lastStepAt = now;
    if (clientThread === null) {
        try {
            clientThread = java.lang.Thread.currentThread();
            startWatchdog();
        } catch (e) {
            debugLogError("lagProbe.clientThread", e);
        }
    }
    startWatchdog();
    drainStallStacks();
    const gc = gcTotals();
    const gcCount = gc === null ? -1 : gc.count - lastGcCount;
    const gcMs = gc === null ? -1 : gc.ms - lastGcMs;
    if (gc !== null) {
        lastGcCount = gc.count;
        lastGcMs = gc.ms;
    }
    const heapNow = heapUsedMB();
    if (gap >= STALL_MS) record(gap, gcCount, gcMs, lastHeapUsedMB, heapNow);
    lastHeapUsedMB = heapNow;
}).setFps(10);
probeStepTrigger.unregister();

register("gameUnload", () => {
    stopWatchdog();
    probeStepTrigger.unregister();
});

export function isLagProbeEnabled(): boolean {
    return Boolean(probeEnabled.get());
}

export function setLagProbeEnabled(enabled: boolean): void {
    if (enabled === isLagProbeEnabled()) return;
    probeEnabled.set(enabled);
    if (enabled) {
        lastStepAt = Date.now();
        const gc = gcTotals();
        if (gc !== null) {
            lastGcCount = gc.count;
            lastGcMs = gc.ms;
        }
        lastHeapUsedMB = heapUsedMB();
        probeStepTrigger.register();
    } else {
        stopWatchdog();
        probeStepTrigger.unregister();
    }
}

export function getLagProbeSamples(): LagSample[] {
    return samples.slice();
}

export function getStallStacks(): string[][] {
    return stallStacks.slice();
}

export function clearLagProbeSamples(): void {
    samples.length = 0;
    stallStacks.length = 0;
    lastStepAt = Date.now();
}
