import { markGuiDirty } from "../lib/dirty";
import { disposeLivePreviews } from "./import-tab/livePreview";

export type FileSelection = {
    path: string;
    importJsonPath: string | null;
};

const confirmed: FileSelection[] = [];
let preview: FileSelection | null = null;
let active: FileSelection | null = null;

export type Tab =
    | { kind: "file"; path: string; importJsonPath: string | null; confirmed: boolean }
    | { kind: "live"; path: string };

let liveTabActive = false;
let dismissedLiveImport = false;
let lastLivePath: string | null = null;
let liveImportPathProvider: (() => string | null) | null = null;

export function setLiveTaskPathProvider(fn: () => string | null): void {
    liveImportPathProvider = fn;
}

function liveImportPath(): string | null {
    if (dismissedLiveImport) return null;
    const path = liveImportPathProvider === null ? null : liveImportPathProvider();
    if (path !== null) {
        lastLivePath = path;
        return path;
    }
    return lastLivePath;
}

export function isLiveTabActive(): boolean {
    return liveTabActive && liveImportPath() !== null;
}

export function selectLiveTab(): void {
    if (liveImportPath() === null) return;
    if (liveTabActive) return;
    liveTabActive = true;
    markGuiDirty();
}

export function closeLiveTab(): void {
    if (dismissedLiveImport && !liveTabActive) return;
    dismissedLiveImport = true;
    liveTabActive = false;
    disposeLivePreviews();
    markGuiDirty();
}

export function rememberLiveTaskPath(path: string): void {
    lastLivePath = path;
}

export function onTaskRunningChanged(
    wasRunning: boolean,
    isRunning: boolean,
    finishedTaskNeedsAttention = false
): void {
    if (!wasRunning && isRunning) {
        disposeLivePreviews();
        dismissedLiveImport = false;
        lastLivePath = null;
        liveTabActive = true;
        markGuiDirty();
    } else if (wasRunning && !isRunning) {
        if (finishedTaskNeedsAttention) return;
        disposeLivePreviews();
        dismissedLiveImport = false;
        lastLivePath = null;
        liveTabActive = false;
        markGuiDirty();
    }
}

// ── Workspace capture / restore ────────────────────────────────────────

export type TabsState = {
    /** Pinned tabs, in order. The preview tab is excluded — it is a
     *  single-click glance, not something the user asked to keep. */
    confirmed: FileSelection[];
    active: FileSelection | null;
};

export function getTabsState(): TabsState {
    const out: FileSelection[] = [];
    for (let i = 0; i < confirmed.length; i++) {
        out.push({
            path: confirmed[i].path,
            importJsonPath: confirmed[i].importJsonPath,
        });
    }
    return {
        confirmed: out,
        // The live tab belongs to a running import, which no longer exists
        // after a reload, so only a real file selection is worth saving.
        active:
            active === null
                ? null
                : { path: active.path, importJsonPath: active.importJsonPath },
    };
}

/**
 * Reopen saved tabs. `exists` filters rows whose file is gone, so a project
 * deleted between sessions doesn't come back as a tab that renders nothing.
 */
export function setTabsState(
    state: TabsState,
    exists: (path: string) => boolean
): void {
    confirmed.length = 0;
    preview = null;
    active = null;
    liveTabActive = false;
    for (let i = 0; i < state.confirmed.length; i++) {
        const entry = state.confirmed[i];
        if (!exists(entry.path)) continue;
        if (confirmedIndex(entry) >= 0) continue;
        confirmed.push({ path: entry.path, importJsonPath: entry.importJsonPath });
    }
    if (state.active !== null && exists(state.active.path)) {
        active = {
            path: state.active.path,
            importJsonPath: state.active.importJsonPath,
        };
        // An active tab that wasn't in the pinned list would otherwise render
        // as content with no tab to match it.
        if (confirmedIndex(active) < 0) confirmed.push(active);
    } else if (confirmed.length > 0) {
        active = confirmed[0];
    }
    markGuiDirty();
}

export function getTabs(): Tab[] {
    const out: Tab[] = [];
    const live = liveImportPath();
    if (live !== null) out.push({ kind: "live", path: live });
    for (let i = 0; i < confirmed.length; i++) {
        out.push({ kind: "file", ...confirmed[i], confirmed: true });
    }
    if (preview !== null) out.push({ kind: "file", ...preview, confirmed: false });
    return out;
}

export function getActivePath(): string | null {
    if (isLiveTabActive()) return liveImportPath();
    return active === null ? null : active.path;
}

export function getActiveFileSelection(): FileSelection | null {
    if (isLiveTabActive() || active === null) return null;
    return { path: active.path, importJsonPath: active.importJsonPath };
}

function fileSelection(path: string, importJsonPath?: string | null): FileSelection {
    return { path, importJsonPath: importJsonPath ?? null };
}

function sameSelection(a: FileSelection | null, b: FileSelection | null): boolean {
    if (a === null || b === null) return a === b;
    return a.path === b.path && a.importJsonPath === b.importJsonPath;
}

function confirmedIndex(selection: FileSelection): number {
    for (let i = 0; i < confirmed.length; i++) {
        if (sameSelection(confirmed[i], selection)) return i;
    }
    return -1;
}

export function previewSelect(path: string, importJsonPath?: string | null): void {
    const next = fileSelection(path, importJsonPath);
    const oldLive = liveTabActive;
    const oldPreview = preview;
    const oldActive = active;
    liveTabActive = false;
    const confirmedIdx = confirmedIndex(next);
    if (confirmedIdx >= 0) {
        preview = null;
    } else {
        preview = next;
    }
    active = next;
    if (
        oldLive !== liveTabActive ||
        !sameSelection(oldPreview, preview) ||
        !sameSelection(oldActive, active)
    ) {
        markGuiDirty();
    }
}

export function confirmSelect(path: string, importJsonPath?: string | null): void {
    const next = fileSelection(path, importJsonPath);
    const oldLive = liveTabActive;
    const oldPreview = preview;
    const oldActive = active;
    const oldLen = confirmed.length;
    liveTabActive = false;
    if (sameSelection(preview, next)) preview = null;
    const idx = confirmedIndex(next);
    if (idx < 0) confirmed.push(next);
    else confirmed[idx] = next;
    active = next;
    if (
        oldLive !== liveTabActive ||
        !sameSelection(oldPreview, preview) ||
        !sameSelection(oldActive, active) ||
        oldLen !== confirmed.length
    ) {
        markGuiDirty();
    }
}

export function pinTab(path: string, importJsonPath?: string | null): void {
    const next = fileSelection(path, importJsonPath);
    const oldPreview = preview;
    const oldLen = confirmed.length;
    if (sameSelection(preview, next)) preview = null;
    const idx = confirmedIndex(next);
    if (idx < 0) confirmed.push(next);
    else confirmed[idx] = next;
    if (!sameSelection(oldPreview, preview) || oldLen !== confirmed.length) markGuiDirty();
}

export function setActiveTab(path: string, importJsonPath?: string | null): void {
    const next = fileSelection(path, importJsonPath);
    const oldLive = liveTabActive;
    const oldPreview = preview;
    const oldActive = active;
    liveTabActive = false;
    if (!sameSelection(preview, next)) preview = null;
    active = next;
    if (
        oldLive !== liveTabActive ||
        !sameSelection(oldPreview, preview) ||
        !sameSelection(oldActive, active)
    ) {
        markGuiDirty();
    }
}

export function closeTabsUnder(dirPath: string): void {
    const prefix = dirPath.charAt(dirPath.length - 1) === "/" ? dirPath : dirPath + "/";
    const all = getTabs();
    for (let i = 0; i < all.length; i++) {
        const tab = all[i];
        if (tab.kind !== "file") continue;
        const p = tab.path;
        if (p === dirPath || p.indexOf(prefix) === 0) closeTab(p, tab.importJsonPath);
    }
}

export function closeTabsForProject(importJsonPath: string): void {
    const all = getTabs();
    for (let i = 0; i < all.length; i++) {
        const tab = all[i];
        if (tab.kind !== "file" || tab.importJsonPath !== importJsonPath) continue;
        closeTab(tab.path, tab.importJsonPath);
    }
}

export function closeTab(path: string, importJsonPath?: string | null): void {
    const exact = arguments.length >= 2;
    const target = fileSelection(path, importJsonPath);
    const oldPreview = preview;
    const oldActive = active;
    const oldLen = confirmed.length;
    if (exact ? sameSelection(preview, target) : preview !== null && preview.path === path) {
        preview = null;
    }
    let firstRemoved = confirmed.length;
    for (let i = confirmed.length - 1; i >= 0; i--) {
        const match = exact ? sameSelection(confirmed[i], target) : confirmed[i].path === path;
        if (!match) continue;
        firstRemoved = i < firstRemoved ? i : firstRemoved;
        confirmed.splice(i, 1);
    }
    const activeRemoved =
        exact ? sameSelection(active, target) : active !== null && active.path === path;
    if (activeRemoved) {
        if (confirmed.length > 0) {
            const idx = firstRemoved < confirmed.length ? firstRemoved : confirmed.length - 1;
            active = confirmed[idx];
        } else {
            active = preview;
        }
    }
    if (
        !sameSelection(oldPreview, preview) ||
        !sameSelection(oldActive, active) ||
        oldLen !== confirmed.length
    ) {
        markGuiDirty();
    }
}

function confirmedIndexFor(
    path: string,
    importJsonPath: string | null | undefined,
    exact: boolean
): number {
    if (exact) return confirmedIndex(fileSelection(path, importJsonPath));
    for (let i = 0; i < confirmed.length; i++) {
        if (confirmed[i].path === path) return i;
    }
    return -1;
}

export function moveTab(path: string, delta: number, importJsonPath?: string | null): void {
    const idx = confirmedIndexFor(path, importJsonPath, arguments.length >= 3);
    if (idx < 0) return;
    const target = Math.max(0, Math.min(confirmed.length - 1, idx + delta));
    if (target === idx) return;
    const [tab] = confirmed.splice(idx, 1);
    confirmed.splice(target, 0, tab);
    markGuiDirty();
}

export function moveTabToStart(path: string, importJsonPath?: string | null): void {
    const idx = confirmedIndexFor(path, importJsonPath, arguments.length >= 2);
    if (idx <= 0) return;
    const [tab] = confirmed.splice(idx, 1);
    confirmed.unshift(tab);
    markGuiDirty();
}

export function moveTabToEnd(path: string, importJsonPath?: string | null): void {
    const idx = confirmedIndexFor(path, importJsonPath, arguments.length >= 2);
    if (idx < 0 || idx === confirmed.length - 1) return;
    const [tab] = confirmed.splice(idx, 1);
    confirmed.push(tab);
    markGuiDirty();
}

export function tabIndex(path: string, importJsonPath?: string | null): number {
    const exact = arguments.length >= 2;
    const target = fileSelection(path, importJsonPath);
    if (exact ? sameSelection(preview, target) : preview !== null && preview.path === path) {
        return confirmed.length;
    }
    return confirmedIndexFor(path, importJsonPath, exact);
}
