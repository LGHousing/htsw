/// <reference types="../../../CTAutocomplete" />

import { Rect, intersectRect } from "./layout";
import { getEffectiveOverlayScale, getOverlayScreenH } from "./overlayScale";
import { GL11 } from "./java";

const scissorStack: Rect[] = [];

export function pushScissor(rect: Rect): void {
    const effective =
        scissorStack.length === 0
            ? rect
            : intersectRect(scissorStack[scissorStack.length - 1], rect);
    scissorStack.push(effective);
    applyScissor(effective);
}

export function popScissor(): void {
    scissorStack.pop();
    if (scissorStack.length === 0) {
        GL11.glDisable(GL11.GL_SCISSOR_TEST);
    } else {
        applyScissor(scissorStack[scissorStack.length - 1]);
    }
}

function applyScissor(rect: Rect): void {
    // Rects are in overlay coords. GL scissor takes real pixels with origin bottom-left, so
    // multiply by the effective overlay scale and y-flip against the overlay screen height
    // (also in overlay coords). Snap to the smallest pixel-aligned box that CONTAINS the
    // float rect (floor the near edges, ceil the far ones) so a fractional scale never
    // truncates a pixel off the top/right edge and clips the first row of content.
    const s = getEffectiveOverlayScale();
    const screenH = getOverlayScreenH();
    const left = Math.floor(rect.x * s);
    const right = Math.ceil((rect.x + rect.w) * s);
    const bottom = Math.floor((screenH - rect.y - rect.h) * s);
    const top = Math.ceil((screenH - rect.y) * s);
    GL11.glEnable(GL11.GL_SCISSOR_TEST);
    GL11.glScissor(left, bottom, Math.max(0, right - left), Math.max(0, top - bottom));
}
