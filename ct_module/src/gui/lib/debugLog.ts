/// <reference types="../../CTAutocomplete" />

/**
 * File-backed GUI diagnostics. Chat is useless for render-path debugging
 * (our own ChatLib output doesn't fire chat triggers, and broken frames may
 * not paint chat at all), so everything lands in gui-debug.log in the
 * deployed module dir, readable from outside the game.
 *
 * Two channels:
 *  - render EXCEPTIONS are always logged (cheap: only fires on failure);
 *  - per-frame state sampling only while armed via `/htsw gui debug <s>`.
 */

const LOG_PATH = "./config/ChatTriggers/modules/HTSW/gui-debug.log";

let armedUntil = 0;
let buffer: string[] = [];

function stamp(): string {
    const d = new Date();
    return (
        `${d.getHours()}:${("0" + d.getMinutes()).slice(-2)}:` +
        `${("0" + d.getSeconds()).slice(-2)}.${("00" + d.getMilliseconds()).slice(-3)}`
    );
}

export function armGuiDebug(seconds: number): void {
    armedUntil = Date.now() + seconds * 1000;
    debugLog(`=== armed for ${seconds}s ===`);
    flushGuiDebug();
}

export function isGuiDebugArmed(): boolean {
    return Date.now() < armedUntil;
}

export function debugLog(line: string): void {
    buffer.push(`[${stamp()}] ${line}`);
    if (buffer.length > 100) flushGuiDebug();
}

export function debugLogError(where: string, e: unknown): void {
    const err = e as { message?: string; stack?: string } | null;
    const msg = err && err.message ? err.message : String(e);
    const stack = err && err.stack ? ` :: ${String(err.stack).split("\n").slice(0, 6).join(" | ")}` : "";
    debugLog(`EXCEPTION in ${where}: ${msg}${stack}`);
    flushGuiDebug();
}

export function flushGuiDebug(): void {
    if (buffer.length === 0) return;
    const out = buffer.join("\n") + "\n";
    buffer = [];
    try {
        FileLib.append(LOG_PATH, out);
    } catch (_e) {
        // diagnostics must never take the GUI down
    }
}
