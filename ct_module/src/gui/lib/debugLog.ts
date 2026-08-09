/// <reference types="../../../CTAutocomplete" />

/**
 * File-backed GUI diagnostics. Chat is useless for render-path debugging
 * (our own ChatLib output doesn't fire chat triggers, and broken frames may
 * not paint chat at all), so render exceptions land in gui-debug.log in the
 * deployed module dir, readable from outside the game.
 */

const LOG_PATH = "./config/ChatTriggers/modules/HTSW/gui-debug.log";

let buffer: string[] = [];

function stamp(): string {
    const d = new Date();
    return (
        `${d.getHours()}:${("0" + d.getMinutes()).slice(-2)}:` +
        `${("0" + d.getSeconds()).slice(-2)}.${("00" + d.getMilliseconds()).slice(-3)}`
    );
}

export function debugLog(line: string): void {
    buffer.push(`[${stamp()}] ${line}`);
    if (buffer.length > 100) flushGuiDebug();
}

export function debugLogError(where: string, e: unknown): void {
    const err = e as { message?: unknown; stack?: unknown } | null;
    const msg = err && typeof err.message === "string" && err.message ? err.message : String(e);
    const stack =
        err && typeof err.stack === "string" && err.stack
            ? ` :: ${err.stack.split("\n").slice(0, 6).join(" | ")}`
            : "";
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
