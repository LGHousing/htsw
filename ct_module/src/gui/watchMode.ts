/// <reference types="../../CTAutocomplete" />

import { getWatchMode, setWatchMode } from "../settings";
import { ensureParentDirs } from "../utils/filesystem";
import { cancelActiveTask } from "../tasks/activeTask";
import { TaskManager } from "../tasks/manager";
import {
    isImportPreparationRunning,
    startImportIfIdle,
} from "./right-panel/import-tab/taskController";
import {
    getQueue,
    isImportQueueItem,
    type ImportQueueItem,
} from "./right-panel/import-tab/queue";
import { getAutoTrackSources } from "./state";
import { showToast } from "./toast";
import { registerBadge } from "./badge";
import type { AutoTrackRefreshTrigger } from "./autoTrack";

const WATCH_COLOR = 0xffe85c5c;

registerBadge(() => {
    if (!getWatchMode()) return null;
    return {
        text: watchImportRunning ? "WATCH: importing…" : "WATCH",
        color: WATCH_COLOR,
        pulse: true,
    };
});
let debounceRevision = 0;
let watchImportRunning = false;
let lastSuccessfulRunKeys: string[] | null = null;
let awaitingSuccessRefresh = false;

function importableKey(item: ImportQueueItem): string | null {
    if (item.kind !== "importable") return null;
    return `${item.sourcePath}|${item.type}:${item.identity}`;
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

function trackedImportQueue(
    trackedSources: ReadonlySet<string>
): ImportQueueItem[] {
    const result: ImportQueueItem[] = [];
    for (const item of getQueue()) {
        if (!isImportQueueItem(item)) continue;
        if (item.kind !== "importable" || !trackedSources.has(item.sourcePath)) continue;
        result.push(item);
    }
    return result;
}

function clearDebounce(): void {
    debounceRevision++;
}

function writeLoopAlarm(keys: readonly string[]): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `./htsw/import-errors/watch-loop-${timestamp}.json`;
    ensureParentDirs(path);
    FileLib.write(
        path,
        JSON.stringify(
            {
                capturedAt: new Date().toISOString(),
                reason: "Watch importables read back as modified immediately after import",
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
    setWatchMode(false);
    clearDebounce();
    awaitingSuccessRefresh = false;
    lastSuccessfulRunKeys = null;
    const path = writeLoopAlarm(keys);
    ChatLib.chat(
        "&c&l[htsw] WATCH MODE DISABLED — importables read back as modified immediately after importing:"
    );
    for (const key of keys) ChatLib.chat(`&c  ${key}`);
    ChatLib.chat("&c[htsw] This may be an importer bug. Please report it.");
    ChatLib.chat(`&c[htsw] Debug log: ${path}`);
    showToast(
        "WATCH MODE DISABLED — imported files immediately read back as modified",
        WATCH_COLOR,
        10000
    );
}

function runWatchImport(): void {
    if (!getWatchMode()) return;
    if (TaskManager.isBusy() || isImportPreparationRunning()) return;
    const trackedItems = trackedImportQueue(getAutoTrackSources());
    if (trackedItems.length === 0) return;
    const runItems = getQueue().filter(isImportQueueItem);
    const runKeys = sortedUnique(
        runItems
            .map(importableKey)
            .filter((key): key is string => key !== null)
    );
    const started = startImportIfIdle(undefined, {
        silentBusy: true,
        onStarted: () => {
            watchImportRunning = true;
            lastSuccessfulRunKeys = runKeys;
            showToast(
                `Watch: importing ${runKeys.length} changed importable(s)`,
                0xff5c9ded,
                4000
            );
        },
        onComplete: (successful) => {
            watchImportRunning = false;
            awaitingSuccessRefresh = successful;
            if (!successful) lastSuccessfulRunKeys = null;
        },
    });
    if (!started) lastSuccessfulRunKeys = null;
}

export function watchModeRefresh(
    trigger: AutoTrackRefreshTrigger,
    changed: number,
    newlyQueuedChanged: number,
    detectedWorkKeys: readonly string[],
    trackedSources: ReadonlySet<string>
): void {
    if (!getWatchMode()) return;
    const detected = sortedUnique(detectedWorkKeys);
    if (awaitingSuccessRefresh) {
        awaitingSuccessRefresh = false;
        if (
            lastSuccessfulRunKeys !== null &&
            detected.length > 0 &&
            identicalKeys(lastSuccessfulRunKeys, detected)
        ) {
            disableForLoop(detected);
            return;
        }
        lastSuccessfulRunKeys = null;
    }
    if (
        trigger === "reparse" &&
        watchImportRunning &&
        (changed > 0 || newlyQueuedChanged > 0)
    ) {
        cancelActiveTask();
        return;
    }
    if (newlyQueuedChanged === 0 && trackedImportQueue(trackedSources).length === 0) {
        return;
    }
    clearDebounce();
    const revision = debounceRevision;
    setTimeout(() => {
        if (revision === debounceRevision) runWatchImport();
    }, 2000);
}

export function setWatchModeEnabled(enabled: boolean): void {
    setWatchMode(enabled);
    if (!enabled) {
        clearDebounce();
        awaitingSuccessRefresh = false;
        lastSuccessfulRunKeys = null;
        showToast("Watch mode off", 0xff5c9ded, 4000);
        ChatLib.chat("&7[htsw] Watch mode disabled.");
        return;
    }
    showToast(
        "WATCH MODE ON — tracked files auto-import. /htsw watch off to disable",
        WATCH_COLOR,
        10000
    );
    ChatLib.chat(
        "&c&l[htsw] WATCH MODE ON &c— tracked files will auto-import. &f/htsw watch off &cto disable."
    );
    if (getAutoTrackSources().size === 0) {
        ChatLib.chat(
            "&e[htsw] No files are tracked yet. Toggle Auto-Track in the Projects tab."
        );
    }
    const tracked = getAutoTrackSources();
    watchModeRefresh("cacheWarm", 0, 0, [], tracked);
}
