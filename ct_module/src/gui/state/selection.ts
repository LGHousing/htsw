const confirmed: string[] = [];
let preview: string | null = null;
let active: string | null = null;

/** Sentinel "path" for the synthetic Progress tab the right panel injects
 * while an import is running. Not a real file — picked to never collide
 * with a filesystem path on either Windows or POSIX. Kept here (next to
 * `setActiveTab`) so it can be used from both the right panel and the
 * import-progress state without creating a circular import. */
export const PROGRESS_TAB_PATH = "<htsw:progress>";

export function isProgressTab(path: string | null): boolean {
    return path === PROGRESS_TAB_PATH;
}

export type Tab = { path: string; confirmed: boolean };

export function getTabs(): Tab[] {
    const out: Tab[] = [];
    for (let i = 0; i < confirmed.length; i++) {
        out.push({ path: confirmed[i], confirmed: true });
    }
    if (preview !== null) out.push({ path: preview, confirmed: false });
    return out;
}

export function getActivePath(): string | null {
    return active;
}

export function previewSelect(path: string): void {
    if (confirmed.indexOf(path) >= 0) {
        preview = null;
    } else {
        preview = path;
    }
    active = path;
}

export function confirmSelect(path: string): void {
    if (preview === path) preview = null;
    if (confirmed.indexOf(path) < 0) confirmed.push(path);
    active = path;
}

export function setActiveTab(path: string): void {
    if (preview !== null && path !== preview) preview = null;
    active = path;
}

export function clearActiveTab(): void {
    active = null;
}

export function closeTab(path: string): void {
    if (preview === path) preview = null;
    const idx = confirmed.indexOf(path);
    if (idx >= 0) confirmed.splice(idx, 1);
    if (active === path) {
        // Pick a sensible neighbour to focus next: the tab that was to the
        // right of the closed one (slides into its slot) if there is one,
        // else the last remaining tab, else nothing.
        if (idx >= 0 && idx < confirmed.length) {
            active = confirmed[idx];
        } else if (confirmed.length > 0) {
            active = confirmed[confirmed.length - 1];
        } else {
            active = preview;
        }
    }
}

/**
 * Reorder a confirmed tab. `delta` is the signed step in the confirmed list
 * (e.g. -1 = move left, +1 = move right). Preview tabs aren't reorderable —
 * they always trail the confirmed list.
 */
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
