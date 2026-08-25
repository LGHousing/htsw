import { emitBridgeEvent } from "../bridge/status";
/// <reference types="../../CTAutocomplete" />

import { getAutoRun, setAutoRun } from "../settings";
import { ensureParentDirs } from "../utils/filesystem";
import { cancelActiveTask } from "../tasks/activeTask";
import { TaskManager } from "../tasks/manager";
import {
    getQueue,
    getQueueRow,
    isRestoredQueueRow,
    type QueueRow,
} from "./right-panel/import-tab/queue";
import {
    isQueueRunning,
    onQueueRunEnded,
    startQueue,
} from "./right-panel/import-tab/queueRunner";
import { getActiveAutoTrackSources } from "./autoTrackScope";
import { dismissToast, showToast } from "./toast";
import { registerBadge } from "./badge";
import type { AutoTrackRefreshTrigger } from "./autoTrack";
import {
    clearPruneNotice,
    getPruneNotice,
    isWatchPruneRunning,
    watchPruneOnReparse,
    watchPruneSweep,
} from "../prune/watch";

const AUTO_RUN_COLOR = 0xffe85c5c;
const AUTO_RUN_PAUSED_COLOR = 0xffe8b45c;

let detectionLive = false;
let debounceRevision = 0;
let startedByAutoRun = false;
let blockedUntilNextParse = false;
let lastSuccessfulImportKeys: string[] | null = null;
let awaitingSuccessRefresh = false;
let runEndedListenerInstalled = false;

function ensureRunEndedListener(): void {
    if (runEndedListenerInstalled) return;
    runEndedListenerInstalled = true;
    onQueueRunEnded(() => autoRunQueueChanged());
}

// Reparse (and therefore save detection) only ticks while the HTSW overlay is
// visible. Keep the old warning, but describe the queue-wide behavior now.
export function setAutoRunDetectionLive(live: boolean): void {
    if (live === detectionLive) return;
    const wasLive = detectionLive;
    detectionLive = live;
    if (wasLive && !live && getAutoRun() && onMultiplayerServer()) {
        showToast(
            "Auto-run paused — open a menu so saves keep being detected",
            AUTO_RUN_PAUSED_COLOR,
            6000,
            "auto-run-paused"
        );
    }
    if (live) dismissToast("auto-run-paused");
}

function onMultiplayerServer(): boolean {
    const ip = Server.getIP();
    return ip !== "" && ip !== "localhost";
}

registerBadge(() => {
    if (!getAutoRun() || !onMultiplayerServer()) return null;
    if (!detectionLive && !startedByAutoRun) {
        return {
            text: "AUTO-RUN: paused — open a menu",
            color: AUTO_RUN_PAUSED_COLOR,
        };
    }
    if (isWatchPruneRunning()) {
        return { text: "AUTO-RUN: pruning…", color: AUTO_RUN_COLOR, pulse: true };
    }
    // Auto-run found this and will not act on it, so it outranks the idle badge.
    const notice = getPruneNotice();
    if (notice !== null && !startedByAutoRun) {
        return {
            text: `AUTO-RUN: ${notice.unownedCount} undeclared — /htsw prune`,
            color: AUTO_RUN_COLOR,
            pulse: true,
        };
    }
    return {
        text: startedByAutoRun ? "AUTO-RUN: running…" : "AUTO-RUN",
        color: AUTO_RUN_COLOR,
        pulse: true,
    };
});

function clearDebounce(): void {
    debounceRevision++;
}

function trackedImportQueue(trackedSources: ReadonlySet<string>): QueueRow[] {
    const rows: QueueRow[] = [];
    for (const row of getQueue()) {
        if (row.op !== "import" || row.status !== "queued") continue;
        if (row.target.kind !== "importable") continue;
        if (!trackedSources.has(row.path)) continue;
        // A row restored from the saved workspace is not evidence of changed
        // work — it is only evidence of what was queued last session.
        if (isRestoredQueueRow(row.key)) continue;
        rows.push(row);
    }
    return rows;
}

// Sits just behind the queue debounce, so a save that both changes and removes
// declarations imports first and prunes on the next idle window.
const PRUNE_DEBOUNCE_MS = 2500;
let pruneDebounceRevision = 0;

/**
 * Queues the cheap "what did this save delete" check for the next idle moment.
 * Queued work outranks it: removing content while its replacement is still
 * queued would leave the house missing things the manifest declares.
 */
function scheduleAutoRunPrune(): void {
    const revision = ++pruneDebounceRevision;
    setTimeout(() => {
        if (revision !== pruneDebounceRevision) return;
        if (!getAutoRun() || !onMultiplayerServer()) return;
        if (TaskManager.isBusy() || isQueueRunning()) return;
        const tracked = getActiveAutoTrackSources();
        if (trackedImportQueue(tracked).length > 0) return;
        watchPruneOnReparse(tracked);
    }, PRUNE_DEBOUNCE_MS);
}

function sortedUnique(keys: readonly string[]): string[] {
    const unique = new Set<string>();
    for (const key of keys) unique.add(key);
    return Array.from(unique).sort();
}

function identicalKeys(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

function queuedImportKeys(rows: readonly QueueRow[]): string[] {
    const keys: string[] = [];
    for (const row of rows) {
        if (row.op !== "import" || row.status !== "queued") continue;
        keys.push(row.key);
    }
    return sortedUnique(keys);
}

function autoRunEligibleRows(): QueueRow[] {
    const rows: QueueRow[] = [];
    for (const row of getQueue()) {
        if (row.status !== "queued" || isRestoredQueueRow(row.key)) continue;
        rows.push(row);
    }
    return rows;
}

function monitorAutoRun(importKeys: readonly string[]): void {
    setTimeout(() => {
        if (isQueueRunning()) {
            monitorAutoRun(importKeys);
            return;
        }
        startedByAutoRun = false;
        // Successful rows remain visible briefly in the queue. Inspect after
        // that done-state window so absence means the import really completed.
        setTimeout(() => {
            let successful = importKeys.length > 0;
            for (const key of importKeys) {
                if (getQueueRow(key) !== null) {
                    successful = false;
                    break;
                }
            }
            awaitingSuccessRefresh = successful;
            lastSuccessfulImportKeys = successful ? importKeys.slice() : null;
            // Prune after apply, so a failed import never costs content it was
            // replacing.
            if (successful) scheduleAutoRunPrune();
        }, 1600);
    }, 100);
}

function runAutoQueue(): void {
    if (!getAutoRun() || blockedUntilNextParse || isQueueRunning()) return;
    const eligible = autoRunEligibleRows();
    if (eligible.length === 0) return;
    const importKeys = queuedImportKeys(eligible);
    if (!startQueue({ autoRun: true })) return;
    startedByAutoRun = true;
    showToast(
        `Auto-run: running ${eligible.length} queued operation${eligible.length === 1 ? "" : "s"}`,
        0xff5c9ded,
        4000
    );
    monitorAutoRun(importKeys);
}

/** Debounce Auto-run after any producer changes the queue. */
export function autoRunQueueChanged(): void {
    if (!getAutoRun()) return;
    ensureRunEndedListener();
    clearDebounce();
    const revision = debounceRevision;
    setTimeout(() => {
        if (revision === debounceRevision) runAutoQueue();
    }, 2000);
}

function writeLoopAlarm(keys: readonly string[]): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `./htsw/import-errors/auto-run-loop-${timestamp}.json`;
    ensureParentDirs(path);
    FileLib.write(
        path,
        JSON.stringify(
            {
                capturedAt: new Date().toISOString(),
                reason: "Auto-run importables read back as modified immediately after import",
                importables: keys,
            },
            null,
            2
        ),
        true
    );
    return path;
}

function disableForLoop(keys: readonly string[]): void {
    setAutoRun(false);
    clearDebounce();
    pruneDebounceRevision++;
    awaitingSuccessRefresh = false;
    lastSuccessfulImportKeys = null;
    const path = writeLoopAlarm(keys);
    emitBridgeEvent("htsw_setting", {
        setting: "auto_run",
        value: false,
        status: "completed",
        reason: "import_loop",
        path,
        keys,
    });
    ChatLib.chat(
        "&c&l[htsw] AUTO-RUN DISABLED — importables read back as modified immediately after importing:"
    );
    for (const key of keys) ChatLib.chat(`&c  ${key}`);
    ChatLib.chat("&c[htsw] This may be an importer bug. Please report it.");
    ChatLib.chat(`&c[htsw] Debug log: ${path}`);
    showToast(
        "AUTO-RUN DISABLED — imported files immediately read back as modified",
        AUTO_RUN_COLOR,
        10000
    );
}

/** Called by the import session when parsing aborts before Housing mutation. */
export function holdAutoRunUntilReparse(): void {
    blockedUntilNextParse = true;
    clearDebounce();
}

export function autoRunRefresh(
    trigger: AutoTrackRefreshTrigger,
    changed: number,
    newlyQueuedChanged: number,
    detectedWorkKeys: readonly string[],
    trackedSources: ReadonlySet<string>
): void {
    if (!getAutoRun()) return;
    if (trigger === "reparse") blockedUntilNextParse = false;

    const detected = sortedUnique(detectedWorkKeys);
    if (awaitingSuccessRefresh) {
        awaitingSuccessRefresh = false;
        if (
            lastSuccessfulImportKeys !== null &&
            detected.length > 0 &&
            identicalKeys(lastSuccessfulImportKeys, detected)
        ) {
            disableForLoop(detected);
            return;
        }
        lastSuccessfulImportKeys = null;
    }

    if (
        trigger === "reparse" &&
        startedByAutoRun &&
        (changed > 0 || newlyQueuedChanged > 0)
    ) {
        const changedKeys = new Set(detectedWorkKeys);
        const runningChanged = getQueue().some(
            (row) =>
                row.op === "import" &&
                row.status === "running" &&
                changedKeys.has(row.key)
        );
        if (runningChanged) {
            cancelActiveTask();
            return;
        }
    }
    // Nothing to import, but the save may still have removed a declaration.
    // Reparse only, or the cache-warm tick re-reads house.lock for nothing.
    if (
        trigger === "reparse" &&
        newlyQueuedChanged === 0 &&
        trackedImportQueue(trackedSources).length === 0
    ) {
        scheduleAutoRunPrune();
    }
    autoRunQueueChanged();
}

export function isAutoRunQueueRunning(): boolean {
    return startedByAutoRun;
}

export function setAutoRunEnabled(enabled: boolean): void {
    setAutoRun(enabled);
    emitBridgeEvent("htsw_setting", {
        setting: "auto_run",
        value: enabled,
        status: "completed",
    });
    if (!enabled) {
        clearDebounce();
        pruneDebounceRevision++;
        awaitingSuccessRefresh = false;
        lastSuccessfulImportKeys = null;
        clearPruneNotice();
        showToast("Auto-run off", 0xff5c9ded, 4000);
        ChatLib.chat("&7[htsw] Auto-run disabled.");
        return;
    }
    showToast(
        "AUTO-RUN ON — queued Housing work runs automatically. /htsw watch off to disable",
        AUTO_RUN_COLOR,
        10000
    );
    ChatLib.chat(
        "&c&l[htsw] AUTO-RUN ON &c— queued Housing work will run automatically. &f/htsw watch off &cto disable."
    );
    autoRunQueueChanged();
    // The one full house scan of an auto-run session, and the only chance to
    // notice content htsw did not create — the lock cannot describe any of it.
    watchPruneSweep(getActiveAutoTrackSources());
}
