const confirmed: string[] = [];
let preview: string | null = null;
let active: string | null = null;

export const LIVE_TAB_PATH = "__htsw_live_import__";

export type Tab =
    | { kind: "file"; path: string; confirmed: boolean }
    | { kind: "live"; path: string };

let liveTabActive = false;
let dismissedLiveImport = false;
let lastLivePath: string | null = null;
let liveImportPathProvider: (() => string | null) | null = null;

export function setLiveImportPathProvider(fn: () => string | null): void {
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
    liveTabActive = true;
}

export function closeLiveTab(): void {
    dismissedLiveImport = true;
    liveTabActive = false;
}

export function onImportRunningChanged(wasRunning: boolean, isRunning: boolean): void {
    if (!wasRunning && isRunning) {
        dismissedLiveImport = false;
        lastLivePath = null;
        liveTabActive = true;
    }
}

export function getTabs(): Tab[] {
    const out: Tab[] = [];
    const live = liveImportPath();
    if (live !== null) out.push({ kind: "live", path: live });
    for (let i = 0; i < confirmed.length; i++) {
        out.push({ kind: "file", path: confirmed[i], confirmed: true });
    }
    if (preview !== null) out.push({ kind: "file", path: preview, confirmed: false });
    return out;
}

export function getActivePath(): string | null {
    if (isLiveTabActive()) return liveImportPath();
    return active;
}

export function previewSelect(path: string): void {
    liveTabActive = false;
    if (confirmed.indexOf(path) >= 0) {
        preview = null;
    } else {
        preview = path;
    }
    active = path;
}

export function confirmSelect(path: string): void {
    liveTabActive = false;
    if (preview === path) preview = null;
    if (confirmed.indexOf(path) < 0) confirmed.push(path);
    active = path;
}

export function pinTab(path: string): void {
    if (preview === path) preview = null;
    if (confirmed.indexOf(path) < 0) confirmed.push(path);
}

export function setActiveTab(path: string): void {
    liveTabActive = false;
    if (preview !== null && path !== preview) preview = null;
    active = path;
}

export function closeTabsUnder(dirPath: string): void {
    const prefix = dirPath.charAt(dirPath.length - 1) === "/" ? dirPath : dirPath + "/";
    const all = getTabs();
    for (let i = 0; i < all.length; i++) {
        const tab = all[i];
        if (tab.kind !== "file") continue;
        const p = tab.path;
        if (p === dirPath || p.indexOf(prefix) === 0) closeTab(p);
    }
}

export function closeTab(path: string): void {
    if (preview === path) preview = null;
    const idx = confirmed.indexOf(path);
    if (idx >= 0) confirmed.splice(idx, 1);
    if (active === path) {
        if (idx >= 0 && idx < confirmed.length) {
            active = confirmed[idx];
        } else if (confirmed.length > 0) {
            active = confirmed[confirmed.length - 1];
        } else {
            active = preview;
        }
    }
}

export function moveTab(path: string, delta: number): void {
    const idx = confirmed.indexOf(path);
    if (idx < 0) return;
    const target = Math.max(0, Math.min(confirmed.length - 1, idx + delta));
    if (target === idx) return;
    const [tab] = confirmed.splice(idx, 1);
    confirmed.splice(target, 0, tab);
}

export function moveTabToStart(path: string): void {
    const idx = confirmed.indexOf(path);
    if (idx <= 0) return;
    const [tab] = confirmed.splice(idx, 1);
    confirmed.unshift(tab);
}

export function moveTabToEnd(path: string): void {
    const idx = confirmed.indexOf(path);
    if (idx < 0 || idx === confirmed.length - 1) return;
    const [tab] = confirmed.splice(idx, 1);
    confirmed.push(tab);
}

export function tabIndex(path: string): number {
    if (preview === path) return confirmed.length;
    return confirmed.indexOf(path);
}

export function tabCount(): number {
    return confirmed.length + (preview === null ? 0 : 1);
}
