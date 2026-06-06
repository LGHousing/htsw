import type { Rect } from "./layout";

// A brief brightening pulse painted over the just-clicked button so a click
// always reads as "something happened", even when the action's result is
// off-screen or instant. Identity is the clicked rect: layout is recomputed
// every frame but a static button keeps its position across the short window,
// so a rect match reliably re-finds the same button.

const FLASH_MS = 180;
const PEAK_ALPHA = 0.3;

let flashRect: Rect | null = null;
let flashAt = 0;

export function registerClickFlash(rect: Rect): void {
    flashRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    flashAt = Date.now();
}

/** White-overlay alpha (0..1) for a rect this frame; 0 when not flashing. */
export function clickFlashAlpha(rect: Rect): number {
    if (flashRect === null) return 0;
    if (
        rect.x !== flashRect.x ||
        rect.y !== flashRect.y ||
        rect.w !== flashRect.w ||
        rect.h !== flashRect.h
    ) {
        return 0;
    }
    const elapsed = Date.now() - flashAt;
    if (elapsed >= FLASH_MS) {
        flashRect = null;
        return 0;
    }
    return PEAK_ALPHA * (1 - elapsed / FLASH_MS);
}
