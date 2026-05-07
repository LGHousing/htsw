/// <reference types="../../CTAutocomplete" />

import { Rect, intersectRect } from "./layout";
import { OVERLAY_SCALE, getOverlayScreenH } from "./overlayScale";

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
    // Rects are in overlay (scale-OVERLAY_SCALE) coords. GL scissor takes real pixels with
    // origin bottom-left, so multiply by OVERLAY_SCALE and y-flip against the overlay screen
    // height (also in overlay coords).
    const screenH = getOverlayScreenH();
    GL11.glEnable(GL11.GL_SCISSOR_TEST);
    GL11.glScissor(
        rect.x * OVERLAY_SCALE,
        (screenH - rect.y - rect.h) * OVERLAY_SCALE,
        rect.w * OVERLAY_SCALE,
        rect.h * OVERLAY_SCALE
    );
}
