/// <reference types="../../CTAutocomplete" />

import { getTaskProgress } from "../gui/right-panel/import-tab/taskProgress";
import { getParsePerfStats } from "../gui/parsing/parses";
import { debugLog, debugLogError, flushGuiDebug } from "../gui/lib/debugLog";
import { TaskManager } from "../tasks/manager";
import { getEventContainerCounts } from "../tasks/specifics/waitFor";

// Rhino's bare package global (see images.ts for the same pattern).
declare const java: any;

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

let lastStepAt = Date.now();
const samples: LagSample[] = [];

// JVM-wide GC totals via the management beans, sampled every step so a
// stall's delta covers exactly that gap. Bean list fetched once (the
// getters themselves are plain counter reads). Reached through Rhino's bare
// `java` package global — the same route `images.ts` uses — because
// `Java.type` lookups of some platform classes have failed in this CT build.
let gcBeans: any = null;
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
        // Rhino hands the List back as a Java Object[] in this CT build, so
        // index with .length, not List.size().
        const n = typeof gcBeans.length === "number" ? gcBeans.length : gcBeans.size();
        for (let i = 0; i < n; i++) {
            const b = typeof gcBeans.length === "number" ? gcBeans[i] : gcBeans.get(i);
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
        const screen = (Client.getMinecraft() as any).field_71462_r;
        if (screen === null || screen === undefined) return "none";
        const name = String(screen.getClass().getName());
        const dot = name.lastIndexOf(".");
        return dot >= 0 ? name.substring(dot + 1) : name;
    } catch (_e) {
        return "unknown";
    }
}

function shortPath(path: string): string {
    const norm = path.replace(/\\/g, "/");
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
        taskRunning: TaskManager.hasRunningTasks(),
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
let clientThread: any = null;
let stackQueue: any = null;
let watchdogStarted = false;

function startWatchdog(): void {
    if (watchdogStarted) return;
    watchdogStarted = true;
    try {
        const ConcurrentLinkedQueue = java.util.concurrent.ConcurrentLinkedQueue;
        stackQueue = new ConcurrentLinkedQueue();
        let capturedForStepAt = 0;
        let capturesThisStall = 0;
        const t = new java.lang.Thread(function () {
            while (true) {
                try {
                    java.lang.Thread.sleep(60);
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
                    const trace = clientThread.getStackTrace();
                    const lines: string[] = [`stack ${stalledForMs}ms into stall:`];
                    const n = Math.min(Number(trace.length), 30);
                    for (let i = 0; i < n; i++) lines.push(String(trace[i].toString()));
                    stackQueue.add(lines.join("\n"));
                } catch (_e) {
                    // never let the watchdog die; next loop retries
                }
            }
        }, "htsw-lagprobe-watchdog");
        t.setDaemon(true);
        t.start();
    } catch (e) {
        debugLogError("lagProbe.startWatchdog", e);
    }
}

function drainStallStacks(): void {
    if (stackQueue === null) return;
    while (true) {
        const item = stackQueue.poll();
        if (item === null) break;
        const lines = String(item).split("\n");
        stallStacks.push(lines);
        if (stallStacks.length > MAX_STACKS) stallStacks.shift();
        debugLog(`[lagprobe] ${lines.join(" | ")}`);
        flushGuiDebug();
    }
}

register("step", () => {
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
}).setFps(60);

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
