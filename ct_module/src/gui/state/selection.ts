const confirmed: string[] = [];
let preview: string | null = null;
let active: string | null = null;

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
