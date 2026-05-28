/// <reference types="../../../CTAutocomplete" />

/**
 * File-based trace of menu operations during import:
 * - Container snapshots on slot-lookup failures (so "Could not find X" shows
 *   what was actually in the menu).
 * - `waitForMenu` entry/exit timing + before/after container title.
 * - Each `openSubmenu` / `setSelectValue` / `setStringValue` / `clickGoBack`
 *   bookended with the current container title.
 *
 * Toggle via `/htsw menu-trace start|stop`. Writes to
 * `./htsw/menu-trace-<timestamp>.jsonl`.
 */

import { removedFormatting } from "../../utils/helpers";

let enabled = false;
let path: string | null = null;
let buffer = "";

export function setMenuTraceEnabled(next: boolean): string | null {
    enabled = next;
    if (enabled) {
        path = `./htsw/menu-trace-${Date.now()}.jsonl`;
        buffer = "";
        appendRaw({ kind: "traceStarted" });
    } else if (path !== null) {
        appendRaw({ kind: "traceStopped" });
    }
    return path;
}

export function isMenuTraceEnabled(): boolean {
    return enabled;
}

export function getMenuTracePath(): string | null {
    return path;
}

function appendRaw(entry: unknown): void {
    if (!enabled || path === null) return;
    try {
        buffer += JSON.stringify({ at: Date.now(), ...entry as Record<string, unknown> }) + "\n";
        FileLib.write(path, buffer, true);
    } catch (_e) {
        // best-effort
    }
}

function safeTitle(): string | null {
    try {
        const c = Player.getContainer();
        if (c == null) return null;
        const name = c.getName();
        return name === null || name === undefined ? null : removedFormatting(String(name));
    } catch (_e) {
        return null;
    }
}

function safeSlotNames(): string[] {
    try {
        const c = Player.getContainer();
        if (c == null) return [];
        const out: string[] = [];
        const size = c.getSize() - 36;
        for (let i = 0; i < size; i++) {
            const item = c.getStackInSlot(i);
            if (item === null || item === undefined) continue;
            try {
                const name = item.getName();
                if (name === null || name === undefined) continue;
                const stripped = removedFormatting(String(name)).trim();
                if (stripped.length === 0) continue;
                out.push(`${i}:${stripped}`);
            } catch (_e) {
                // skip slot
            }
        }
        return out;
    } catch (_e) {
        return [];
    }
}

export function traceSlotLookup(query: string, found: boolean): void {
    if (!enabled) return;
    if (found) return;
    appendRaw({
        kind: "slotLookupFailed",
        query,
        title: safeTitle(),
        slots: safeSlotNames(),
    });
}

export function traceWaitForMenuStart(label: string): { id: number; startMs: number; titleBefore: string | null } {
    const ctx = { id: Math.floor(Math.random() * 1e9), startMs: Date.now(), titleBefore: enabled ? safeTitle() : null };
    if (enabled) {
        appendRaw({
            kind: "waitForMenuStart",
            id: ctx.id,
            label,
            titleBefore: ctx.titleBefore,
        });
    }
    return ctx;
}

export function traceWaitForMenuEnd(token: { id: number; startMs: number; titleBefore: string | null }, label: string, timedOut: boolean): void {
    if (!enabled) return;
    appendRaw({
        kind: "waitForMenuEnd",
        id: token.id,
        label,
        timedOut,
        elapsedMs: Date.now() - token.startMs,
        titleBefore: token.titleBefore,
        titleAfter: safeTitle(),
    });
}

export function traceMenuOp(op: string, phase: "enter" | "exit", details?: Record<string, unknown>): void {
    if (!enabled) return;
    appendRaw({
        kind: "op",
        op,
        phase,
        title: safeTitle(),
        ...details,
    });
}
