/// <reference types="../../../CTAutocomplete" />

import type { Rect } from "../lib/layout";
import { javaType } from "../lib/java";
import { moveTab, tabIndex } from "./selection";

const MouseClass = javaType("org.lwjgl.input.Mouse");
const DRAG_THRESHOLD = 4;

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

export function endTabDrag(): void {
    dragState = null;
}
