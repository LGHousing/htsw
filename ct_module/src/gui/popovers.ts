/// <reference types="../../CTAutocomplete" />

import { Element, Rect, pointInRect, layoutElement } from "./layout";
import { renderElement, dispatchClick } from "./render";

export type PopoverHandle = {
    id: number;
    anchor: Rect;
    content: Element;
    width: number;
    height: number;
    openedAt: number;
    onClose?: () => void;
};

const OPEN_GRACE_MS = 250;

let nextId = 1;
let openPopovers: PopoverHandle[] = [];
let renderInitialized = false;

export function openPopover(opts: {
    anchor: Rect;
    content: Element;
    width: number;
    height: number;
    onClose?: () => void;
}): PopoverHandle {
    const handle: PopoverHandle = {
        id: nextId++,
        anchor: opts.anchor,
        content: opts.content,
        width: opts.width,
        height: opts.height,
        openedAt: Date.now(),
        onClose: opts.onClose,
    };
    openPopovers.push(handle);
    return handle;
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

export function popoverIsOpen(): boolean { return openPopovers.length > 0; }

function computePopoverRect(p: PopoverHandle): Rect {
    const screenH = Renderer.screen.getHeight();
    const screenW = Renderer.screen.getWidth();
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
export function tryDispatchPopoverClick(mouseX: number, mouseY: number): boolean {
    if (openPopovers.length === 0) return false;
    for (let i = openPopovers.length - 1; i >= 0; i--) {
        const p = openPopovers[i];
        const rect = computePopoverRect(p);
        if (pointInRect(rect, mouseX, mouseY)) {
            const laid = layoutElement(p.content, rect.x, rect.y, rect.w, rect.h);
            dispatchClick(laid, mouseX, mouseY);
            return true;
        }
    }
    // Outside all popovers: close stale ones.
    const now = Date.now();
    const fresh: PopoverHandle[] = [];
    const stale: PopoverHandle[] = [];
    for (let i = 0; i < openPopovers.length; i++) {
        if (now - openPopovers[i].openedAt < OPEN_GRACE_MS) fresh.push(openPopovers[i]);
        else stale.push(openPopovers[i]);
    }
    if (stale.length > 0) {
        openPopovers = fresh;
        for (let i = 0; i < stale.length; i++) {
            if (stale[i].onClose) stale[i].onClose!();
        }
    }
    return false;
}

export function initPopoverRendering(): void {
    if (renderInitialized) return;
    renderInitialized = true;
    register("guiRender", (mouseX: number, mouseY: number) => {
        for (let i = 0; i < openPopovers.length; i++) {
            const p = openPopovers[i];
            const rect = computePopoverRect(p);
            Renderer.drawRect(0xf0242931 | 0, rect.x, rect.y, rect.w, rect.h);
            renderElement(p.content, rect.x, rect.y, rect.w, rect.h, mouseX, mouseY, true);
        }
    }).setPriority(OnTrigger.Priority.LOWEST);
}

// True when mouseX/mouseY is inside any open popover's rect — used to suppress hover on panels.
export function mouseIsOverPopover(mouseX: number, mouseY: number): boolean {
    for (let i = 0; i < openPopovers.length; i++) {
        const rect = computePopoverRect(openPopovers[i]);
        if (pointInRect(rect, mouseX, mouseY)) return true;
    }
    return false;
}
