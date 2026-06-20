/// <reference types="../../../CTAutocomplete" />

import { getScrollState, setScrollOffset, type Rect } from "../lib/layout";
import { javaType } from "../lib/java";
import { moveTab, tabIndex } from "./selection";

const MouseClass = javaType("org.lwjgl.input.Mouse");
const DRAG_THRESHOLD = 4;

/** Scroll id of the View-pane tab strip (a horizontal scroll). */
export const TAB_STRIP_SCROLL_ID = "right-view-tab-strip";
// While dragging a tab, holding the cursor this close to a viewport edge
// auto-scrolls the strip, so a tab can be dragged into (and back from) the part
// of the list currently scrolled out of view — reorder targets only exist for
// tabs that are laid out, which the cull skips once they're off-screen.
const EDGE_AUTOSCROLL_ZONE = 18;
const EDGE_AUTOSCROLL_SPEED = 7;

type DragState = {
    path: string;
    startX: number;
    startY: number;
    dragging: boolean;
};

let dragState: DragState | null = null;

export function beginTabDrag(path: string, mouseX: number, mouseY: number): void {
    dragState = { path, startX: mouseX, startY: mouseY, dragging: false };
}

export function updateTabDrag(targetPath: string, _rect: Rect, mouseX: number, mouseY: number): void {
    if (dragState === null) return;
    if (!MouseClass.isButtonDown(0)) {
        endTabDrag();
        return;
    }
    if (!dragState.dragging) {
        const dx = mouseX - dragState.startX;
        const dy = mouseY - dragState.startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
        dragState.dragging = true;
    }

    const from = tabIndex(dragState.path);
    const to = tabIndex(targetPath);
    if (from < 0 || to < 0 || from === to) return;
    moveTab(dragState.path, to - from);
}

export function isTabDragging(path: string): boolean {
    return dragState !== null && dragState.dragging && dragState.path === path;
}

/**
 * Per-frame auto-scroll while a tab drag is active and the cursor sits near a
 * strip edge. Driven from the overlay tick (the tab rows' own `onHover` can't
 * fire for tabs the cull has dropped off-screen). `mouseX` is in overlay space.
 */
export function tickTabDragAutoScroll(mouseX: number): void {
    if (dragState === null || !dragState.dragging) return;
    const s = getScrollState(TAB_STRIP_SCROLL_ID);
    const v = s.viewportRect;
    if (v.w <= 0 || s.contentLength <= v.w) return;
    const maxOffset = s.contentLength - v.w;
    if (mouseX < v.x + EDGE_AUTOSCROLL_ZONE && s.offset > 0) {
        setScrollOffset(TAB_STRIP_SCROLL_ID, s.offset - EDGE_AUTOSCROLL_SPEED);
    } else if (mouseX > v.x + v.w - EDGE_AUTOSCROLL_ZONE && s.offset < maxOffset) {
        setScrollOffset(TAB_STRIP_SCROLL_ID, s.offset + EDGE_AUTOSCROLL_SPEED);
    }
}

export function endTabDrag(): void {
    dragState = null;
}
