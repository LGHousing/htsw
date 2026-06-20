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
 * Two signals, both framework-level — tree-building consumers never opt in:
 *
 *  - `markGuiDirty()`: an interaction or active animation that may change the
 *    tree's STRUCTURE — clicks, wheel, typed input, an in-progress drag, a
 *    running import. Bumps a revision the panel compares against.
 *  - a time backstop (`GUI_REBUILD_BACKSTOP_MS`, applied in the panel): async
 *    changes that don't route through `markGuiDirty` — a parse finishing,
 *    housing detection, a toast — self-heal within the backstop window instead
 *    of needing an explicit hook at every mutation site. Worst case is a few
 *    hundred ms of structural staleness, never permanent: the same failure
 *    mode as the codebase's existing TTL caches (`memoizedImportableHash`,
 *    `treeRows`).
 *
 * Value-level changes (a color/text/background closure returning something new)
 * already reflect immediately, because the cached `LaidOut` holds the live
 * element objects and the draw loop re-extracts their closures every frame. The
 * backstop only governs changes to which elements exist and their sizes.
 */

let revision = 0;

export function markGuiDirty(): void {
    revision++;
}

export function getGuiRevision(): number {
    return revision;
}

export const GUI_REBUILD_BACKSTOP_MS = 200;
