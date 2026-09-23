/// <reference types="../../../../CTAutocomplete" />

import { getScrollState, setScrollOffset } from "../../lib/layout";
import { javaType } from "../../lib/java";
import { markGuiDirty } from "../../lib/dirty";
import { getHousingUuid } from "../../state";
import { getQueue, getQueueRow, moveQueueRowsOnto, queuePeerKeys } from "./queue";

const MouseClass = javaType("org.lwjgl.input.Mouse");
const KeyboardClass = javaType("org.lwjgl.input.Keyboard");
const KEY_LSHIFT = 42;
const KEY_RSHIFT = 54;
const DRAG_THRESHOLD = 4;

export const QUEUE_SCROLL_ID = "right-import-queue-scroll";
// Holding the cursor this close to the top or bottom of the queue while
// dragging scrolls it, so rows can reach rows the virtual list has not built.
const EDGE_AUTOSCROLL_ZONE = 12;
const EDGE_AUTOSCROLL_SPEED = 4;

type DragState = {
    keys: string[];
    startX: number;
    startY: number;
    lastY: number;
    dragging: boolean;
    /** Runs on release when the press never became a drag. */
    onClick: () => void;
};

let dragState: DragState | null = null;
// Shift+click selects the rows between the anchor and the clicked row, and
// dragging any selected row moves the whole selection.
const selected = new Set<string>();
let anchorKey: string | null = null;

function selectedInQueueOrder(): string[] {
    return getQueue()
        .filter((row) => selected.has(row.key))
        .map((row) => row.key);
}

/** Press on a top-level row: extends the selection with Shift, and may start a drag. */
export function pressQueueRow(
    key: string,
    mouseX: number,
    mouseY: number,
    onClick: () => void
): void {
    let keys: string[];
    let click = onClick;
    if (KeyboardClass.isKeyDown(KEY_LSHIFT) || KeyboardClass.isKeyDown(KEY_RSHIFT)) {
        const peers = queuePeerKeys(key, getHousingUuid());
        const to = peers.indexOf(key);
        const anchor = anchorKey === null ? -1 : peers.indexOf(anchorKey);
        const from = anchor < 0 ? to : anchor;
        selected.clear();
        for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
            selected.add(peers[i]);
        }
        keys = selectedInQueueOrder();
        click = () => undefined;
    } else if (selected.has(key) && selected.size > 1) {
        keys = selectedInQueueOrder();
        click = () => {
            selected.clear();
            anchorKey = key;
            onClick();
        };
    } else {
        selected.clear();
        anchorKey = key;
        keys = [key];
    }
    dragState = {
        keys,
        startX: mouseX,
        startY: mouseY,
        lastY: mouseY,
        dragging: false,
        onClick: click,
    };
    markGuiDirty();
}

/** `targetKey` is the top-level row under the cursor (a child reports its bulk parent). */
export function updateQueueDrag(targetKey: string, mouseX: number, mouseY: number): void {
    if (dragState === null) return;
    if (!MouseClass.isButtonDown(0)) {
        endQueueDrag();
        return;
    }
    const dy = mouseY - dragState.lastY;
    dragState.lastY = mouseY;
    if (!dragState.dragging) {
        const dx = mouseX - dragState.startX;
        const fromStart = mouseY - dragState.startY;
        if (dx * dx + fromStart * fromStart < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
        dragState.dragging = true;
        markGuiDirty();
    }
    if (dragState.keys.indexOf(targetKey) >= 0) return;
    // Only move the way the cursor travels. Rows differ in height (an expanded
    // bulk row carries its children), so a move can leave the cursor over the
    // row it just passed, which would otherwise move straight back.
    const queue = getQueue();
    const first = dragState.keys[0];
    const from = queue.findIndex((row) => row.key === first);
    const to = queue.findIndex((row) => row.key === targetKey);
    if (from < 0 || to < 0 || (to > from ? dy <= 0 : dy >= 0)) return;
    moveQueueRowsOnto(dragState.keys, targetKey, getHousingUuid());
}

export function isQueueRowDragging(key: string): boolean {
    return dragState !== null && dragState.dragging && dragState.keys.indexOf(key) >= 0;
}

export function isQueueRowSelected(key: string): boolean {
    return selected.has(key) && getQueueRow(key) !== null;
}

/** Per-frame edge auto-scroll, driven from the overlay tick. `mouseY` is in overlay space. */
export function tickQueueDragAutoScroll(mouseY: number): void {
    if (dragState === null || !dragState.dragging) return;
    const s = getScrollState(QUEUE_SCROLL_ID);
    const v = s.viewportRect;
    if (v.h <= 0 || s.contentLength <= v.h) return;
    const maxOffset = s.contentLength - v.h;
    if (mouseY < v.y + EDGE_AUTOSCROLL_ZONE && s.offset > 0) {
        setScrollOffset(QUEUE_SCROLL_ID, s.offset - EDGE_AUTOSCROLL_SPEED);
        markGuiDirty();
    } else if (mouseY > v.y + v.h - EDGE_AUTOSCROLL_ZONE && s.offset < maxOffset) {
        setScrollOffset(QUEUE_SCROLL_ID, s.offset + EDGE_AUTOSCROLL_SPEED);
        markGuiDirty();
    }
}

export function endQueueDrag(): void {
    if (dragState === null) return;
    const clicked = !dragState.dragging;
    const onClick = dragState.onClick;
    dragState = null;
    markGuiDirty();
    if (clicked) onClick();
}
