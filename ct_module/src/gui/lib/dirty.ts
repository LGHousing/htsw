/**
 * Retained-layout dirty tracking.
 *
 * The overlay is immediate-mode: every frame would otherwise rebuild the whole
 * element tree — running every `children: () => [...]` closure (the cache
 * scans, path canonicalization, status lookups) — and re-run layout, even
 * though nothing changed on the overwhelming majority of frames. Panels cache
 * their laid-out tree and rebuild only when this module says something may have
 * changed; the draw loop still runs every frame (the screen is cleared each
 * frame, and hover / click-flash / cursor / value closures all resolve at draw
 * time, so they stay live at 60fps without a rebuild).
 *
 * `markGuiDirty()` is owned by the state mutation that changes the tree's
 * STRUCTURE — clicks, wheel, typed input, an in-progress drag, a running
 * import, or an async parse completing. It bumps a revision the panel compares
 * against.
 *
 * Value-level changes (a color/text/background closure returning something new)
 * already reflect immediately, because the cached `LaidOut` holds the live
 * element objects and the draw loop re-extracts their closures every frame.
 * The dirty signal governs changes to which elements exist and their sizes.
 */

let revision = 0;

export function markGuiDirty(): void {
    revision++;
}

export function getGuiRevision(): number {
    return revision;
}
