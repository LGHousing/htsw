/// <reference types="../../CTAutocomplete" />

import { Rect, intersectRect } from "./layout";
import { getEffectiveOverlayScale, getOverlayScreenH } from "./overlayScale";

// @ts-ignore
const GL11 = org.lwjgl.opengl.GL11;

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
    // (also in overlay coords).
    const s = getEffectiveOverlayScale();
    const screenH = getOverlayScreenH();
    GL11.glEnable(GL11.GL_SCISSOR_TEST);
    GL11.glScissor(
        rect.x * s,
        (screenH - rect.y - rect.h) * s,
        rect.w * s,
        rect.h * s
    );
}
