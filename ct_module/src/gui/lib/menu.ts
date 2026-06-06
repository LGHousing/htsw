/// <reference types="../../CTAutocomplete" />

import { Element } from "./layout";
import { Button, Col, Container } from "./components";
import { closeAllPopovers, closePopover, openPopover, type PopoverHandle } from "./popovers";
import { COLOR_PANEL_BORDER } from "./theme";
import type { IconName } from "./icons.generated";

export type MenuAction =
    | { kind?: "action"; label: string; onClick: () => void; icon?: IconName }
    | { kind: "separator" };

const ITEM_H = 18;
const SEPARATOR_H = 5;
const PAD = 4;
const GAP = 2;
const MIN_MENU_WIDTH = 120;
// Button text is centered with a 2px min margin on each side, and the button
// itself is inset from the menu by PAD on each side. Width must be at least
// text_w + 2*2 (button margin) + 2*PAD (menu padding) to avoid overflow.
const TEXT_FRAME_W = 4 + PAD * 2;

function isAction(
    a: MenuAction
): a is { kind?: "action"; label: string; onClick: () => void } {
    return a.kind !== "separator";
}

function actionElement(
    a: MenuAction,
    closeMenu: () => void
): Element {
    if (!isAction(a)) {
        return Container({
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: SEPARATOR_H },
                padding: { side: "y", value: 2 },
            },
            children: [
                Container({
                    style: {
                        width: { kind: "grow" },
                        height: { kind: "px", value: 1 },
                        background: COLOR_PANEL_BORDER,
                    },
                    children: [],
                }),
            ],
        });
    }
    return Button({
        text: a.label,
        icon: a.icon,
        style: { width: { kind: "grow" }, height: { kind: "px", value: ITEM_H } },
        onClick: () => {
            closeMenu();
            a.onClick();
        },
    });
}

// A button icon is 16px + a 4px gap before the label.
const ICON_ALLOWANCE = 20;

function menuWidthFor(actions: MenuAction[]): number {
    let maxLabelW = 0;
    let hasIcon = false;
    for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if (!isAction(a)) continue;
        const w = Renderer.getStringWidth(a.label);
        if (w > maxLabelW) maxLabelW = w;
        if (a.icon !== undefined) hasIcon = true;
    }
    const desired = maxLabelW + TEXT_FRAME_W + (hasIcon ? ICON_ALLOWANCE : 0);
    return desired < MIN_MENU_WIDTH ? MIN_MENU_WIDTH : desired;
}

// The single context menu allowed open at a time. On the `keepUnderlying` path we don't
// call closeAllPopovers (it would whisk away the parent popover), so without this a second
// right-click would stack a second menu on top of the first.
let activeMenu: PopoverHandle | null = null;

// Open a context menu anchored at the given screen position (typically the cursor).
// By default any currently-open popovers are closed first so successive right-clicks don't
// stack menus. Pass `keepUnderlying: true` to keep parent popovers (e.g. when right-clicking
// inside the file-browser popover — closing the parent would whisk the browser away).
export function openMenu(
    x: number,
    y: number,
    actions: MenuAction[],
    options?: { keepUnderlying?: boolean }
): void {
    if (actions.length === 0) return;
    if (activeMenu !== null) {
        closePopover(activeMenu);
        activeMenu = null;
    }
    if (!options?.keepUnderlying) closeAllPopovers();
    let height = PAD * 2;
    for (let i = 0; i < actions.length; i++) {
        height += isAction(actions[i]) ? ITEM_H : SEPARATOR_H;
        if (i > 0) height += GAP;
    }
    let handle: PopoverHandle | null = null;
    const closeMenu = () => {
        if (handle !== null) {
            closePopover(handle);
            handle = null;
        } else {
            closeAllPopovers();
        }
    };
    const content: Element = Col({
        style: { padding: PAD, gap: GAP },
        children: actions.map((a) => actionElement(a, closeMenu)),
    });
    // 0×0 anchor at the cursor for positioning. Context menus have no re-clickable trigger so
    // the anchor-exclusion close guard isn't useful — the off-screen `excludeAnchor` flag opts
    // out so a left-click anywhere (including the original cursor pixel) cleanly closes the menu.
    const menuPopover = openPopover({
        anchor: { x, y, w: 0, h: 0 },
        excludeAnchor: false,
        content,
        width: menuWidthFor(actions),
        height,
        onClose: () => {
            handle = null;
            if (activeMenu === menuPopover) activeMenu = null;
        },
    });
    handle = menuPopover;
    activeMenu = menuPopover;
}
