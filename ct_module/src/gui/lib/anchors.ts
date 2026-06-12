import type { Rect } from "./layout";

/**
 * Per-frame registry of where named regions landed on screen. A container
 * with an `anchorKey` reports its laid-out rect every rendered frame; code
 * outside the tree (the tour's spotlight, popover anchoring) reads it back.
 * Entries go stale instead of being cleared — a region that stopped
 * rendering (tab switched away) simply stops reporting, and readers treat
 * an old rect as absent.
 */

type Entry = { rect: Rect; at: number };

const STALE_MS = 300;
const entries = new Map<string, Entry>();

export function reportAnchorRect(key: string, rect: Rect): void {
    entries.set(key, { rect, at: Date.now() });
}

export function getAnchorRect(key: string): Rect | null {
    const e = entries.get(key);
    if (e === undefined || Date.now() - e.at > STALE_MS) return null;
    return e.rect;
}
