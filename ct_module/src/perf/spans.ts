/// <reference types="../../CTAutocomplete" />

import { debugLog } from "../gui/lib/debugLog";

/**
 * Named slices of client-thread work for `/htsw lagprobe`. When scripts run
 * interpreted, a stall's Java stack shows only Rhino frames, so spans record
 * which entry point was running. Spans nest and log innermost first. While the
 * probe is off a span is one comparison and a direct call.
 */

type SlowSpan = { at: number; ms: number; path: string };

const MAX_SLOW_SPANS = 40;

let thresholdMs = -1;
const stack: string[] = [];
const slowSpans: SlowSpan[] = [];
// Read by the lag probe's watchdog thread to tag a mid-stall stack capture. A
// string swap can't tear; a stale read only mislabels one capture.
let activePath = "";

export function setSpanThreshold(ms: number | null): void {
    thresholdMs = ms === null ? -1 : ms;
    stack.length = 0;
    activePath = "";
}

export function activeSpanPath(): string {
    return activePath;
}

export function getSlowSpans(): SlowSpan[] {
    return slowSpans.slice();
}

export function clearSlowSpans(): void {
    slowSpans.length = 0;
}

export function span<T>(name: string, fn: () => T): T {
    if (thresholdMs < 0) return fn();
    stack.push(name);
    activePath = stack.join(" > ");
    const startedAt = Date.now();
    try {
        return fn();
    } finally {
        const ms = Date.now() - startedAt;
        const path = activePath;
        stack.pop();
        activePath = stack.join(" > ");
        if (thresholdMs >= 0 && ms >= thresholdMs) {
            slowSpans.push({ at: Date.now(), ms, path });
            if (slowSpans.length > MAX_SLOW_SPANS) slowSpans.shift();
            debugLog(`[lagprobe] slow span ${ms}ms: ${path}`);
        }
    }
}
