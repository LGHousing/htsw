/// <reference types="../../CTAutocomplete" />

import { Element, Rect, pointInRect, layoutElement } from "./layout";
import { renderElement, dispatchClick } from "./render";
import { bumpLastPostRender, postRecentlyFired, resetGuiState } from "./panel";

export type PopoverHandle = {
    id: number;
    key?: string;
    anchor: Rect;
    // When true, an outside-click on `anchor` keeps the popover open. This is what makes a
    // button-style trigger (Sort/Filter) toggle correctly — without it, the same click that
    // hits the trigger would also auto-close the popover, racing with togglePopover. For
    // cursor-anchored menus that have no re-clickable trigger, set this false.
    excludeAnchor: boolean;
    content: Element;
    width: number;
    height: number;
    openedAt: number;
    /**
     * "anchored" — placed adjacent to the trigger anchor (default).
     * "modal"    — centered on the screen and a full-screen scrim is drawn
     *              behind it; outside-clicks still close after the grace
     *              window so the user can dismiss by clicking off.
     */
    placement: "anchored" | "modal";
    onClose?: () => void;
};

import { COLOR_OVERLAY_DIM, COLOR_PANEL, COLOR_PANEL_BORDER } from "../theme";

let nextId = 1;
let openPopovers: PopoverHandle[] = [];
let renderInitialized = false;

export function openPopover(opts: {
    anchor: Rect;
    content: Element;
    width: number;
    height: number;
    key?: string;
    placement?: "anchored" | "modal";
    excludeAnchor?: boolean;
    onClose?: () => void;
}): PopoverHandle {
    const handle: PopoverHandle = {
        id: nextId++,
        key: opts.key,
        anchor: opts.anchor,
        excludeAnchor: opts.excludeAnchor !== false,
        content: opts.content,
        width: opts.width,
        height: opts.height,
        openedAt: Date.now(),
        placement: opts.placement ?? "anchored",
        onClose: opts.onClose,
    };
    openPopovers.push(handle);
    return handle;
}

// Open a popover keyed by `key`; if one with the same key is already open, close it instead.
// Use this for toggle-style triggers (e.g. a Filter button that re-clicks to dismiss).
export function togglePopover(opts: {
    key: string;
    anchor: Rect;
    content: Element;
    width: number;
    height: number;
    placement?: "anchored" | "modal";
    onClose?: () => void;
}): PopoverHandle | null {
    for (let i = 0; i < openPopovers.length; i++) {
        if (openPopovers[i].key === opts.key) {
            closePopover(openPopovers[i]);
            return null;
        }
    }
    return openPopover(opts);
}

export function closePopover(handle: PopoverHandle): void {
    const idx = openPopovers.indexOf(handle);
    if (idx < 0) return;
    openPopovers.splice(idx, 1);
    if (handle.onClose) handle.onClose();
}

export function closeAllPopovers(): void {
    const popovers = openPopovers;
    openPopovers = [];
    for (let i = 0; i < popovers.length; i++) {
        if (popovers[i].onClose) popovers[i].onClose!();
    }
}

export function popoverIsOpen(): boolean {
    return openPopovers.length > 0;
}

function computePopoverRect(p: PopoverHandle): Rect {
    const screenH = Renderer.screen.getHeight();
    const screenW = Renderer.screen.getWidth();
    if (p.placement === "modal") {
        const w = Math.min(p.width, screenW - 8);
        const h = Math.min(p.height, screenH - 8);
        return {
            x: Math.floor((screenW - w) / 2),
            y: Math.floor((screenH - h) / 2),
            w,
            h,
        };
    }
    const anchor = p.anchor;
    const anchorCenterY = anchor.y + anchor.h / 2;
    const goesBelow = anchorCenterY < screenH / 2;
    const y = goesBelow ? anchor.y + anchor.h + 2 : anchor.y - p.height - 2;
    let x = anchor.x;
    if (x + p.width > screenW - 2) x = screenW - 2 - p.width;
    if (x < 2) x = 2;
    return { x, y, w: p.width, h: p.height };
}

// Called by panel click handlers BEFORE their own dispatch. Returns true if the click was
// inside any popover (handler invoked, event should be cancelled by caller). Returns false
// if the click was outside all popovers — caller should also return without dispatching.
// On outside click, popovers older than OPEN_GRACE_MS are closed.
export function tryDispatchPopoverClick(
    mouseX: number,
    mouseY: number,
    button: number
): boolean {
    if (openPopovers.length === 0) return false;
    for (let i = openPopovers.length - 1; i >= 0; i--) {
        const p = openPopovers[i];
        const rect = computePopoverRect(p);
        if (pointInRect(rect, mouseX, mouseY)) {
            const laid = layoutElement(p.content, rect.x, rect.y, rect.w, rect.h);
            dispatchClick(laid, mouseX, mouseY, button);
            return true;
        }
    }
    // Outside all popovers: close them, EXCEPT when the click is on the popover's own
    // anchor (the trigger). Auto-closing in that case races with togglePopover and you'd need
    // to click the trigger twice to dismiss.
    const fresh: PopoverHandle[] = [];
    const stale: PopoverHandle[] = [];
    for (let i = 0; i < openPopovers.length; i++) {
        const p = openPopovers[i];
        const onAnchor = p.excludeAnchor && pointInRect(p.anchor, mouseX, mouseY);
        if (onAnchor) fresh.push(p);
        else stale.push(p);
    }
    if (stale.length > 0) {
        openPopovers = fresh;
        for (let i = 0; i < stale.length; i++) {
            if (stale[i].onClose) stale[i].onClose!();
        }
    }
    // If any modal is still open, absorb the click so it doesn't fall
    // through to the underlying panel — modals are interaction-blocking.
    for (let i = 0; i < openPopovers.length; i++) {
        if (openPopovers[i].placement === "modal") return true;
    }
    return false;
}

function drawPopovers(mouseX: number, mouseY: number): void {
    if (openPopovers.length === 0) return;
    resetGuiState();
    let scrimDrawn = false;
    for (let i = 0; i < openPopovers.length; i++) {
        const p = openPopovers[i];
        if (p.placement === "modal" && !scrimDrawn) {
            const sw = Renderer.screen.getWidth();
            const sh = Renderer.screen.getHeight();
            Renderer.drawRect(COLOR_OVERLAY_DIM, 0, 0, sw, sh);
            scrimDrawn = true;
        }
        const rect = computePopoverRect(p);
        Renderer.drawRect(
            COLOR_PANEL_BORDER,
            rect.x - 1,
            rect.y - 1,
            rect.w + 2,
            rect.h + 2
        );
        Renderer.drawRect(COLOR_PANEL, rect.x, rect.y, rect.w, rect.h);
        renderElement(
            p.content,
            rect.x,
            rect.y,
            rect.w,
            rect.h,
            mouseX,
            mouseY,
            true
        );
    }
}

export function initPopoverRendering(): void {
    if (renderInitialized) return;
    renderInitialized = true;
    // Same dual-path scheme as Panel: postGuiRender for clean overlay
    // (paints after MC slots), guiRender as fallback for builds where
    // postGuiRender doesn't fire. LOWEST priority so popovers always
    // paint last, on top of panels.
    register("postGuiRender", (mouseX: number, mouseY: number) => {
        bumpLastPostRender();
        drawPopovers(mouseX, mouseY);
    }).setPriority(OnTrigger.Priority.LOWEST);
    register("guiRender", (mouseX: number, mouseY: number) => {
        if (postRecentlyFired()) return;
        drawPopovers(mouseX, mouseY);
    }).setPriority(OnTrigger.Priority.LOWEST);
}

// True when mouseX/mouseY is inside any open popover's rect — used to suppress hover on panels.
// Modals always return true (their scrim absorbs all hover anywhere on screen).
export function mouseIsOverPopover(mouseX: number, mouseY: number): boolean {
    for (let i = 0; i < openPopovers.length; i++) {
        if (openPopovers[i].placement === "modal") return true;
        const rect = computePopoverRect(openPopovers[i]);
        if (pointInRect(rect, mouseX, mouseY)) return true;
    }
    return false;
}
