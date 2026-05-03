/// <reference types="../../CTAutocomplete" />

import { Element } from "./layout";
import { Button, Col } from "./components";
import { closeAllPopovers, openPopover } from "./popovers";

export type MenuAction = { label: string; onClick: () => void };

const ITEM_H = 18;
const PAD = 4;
const GAP = 2;
const MENU_WIDTH = 120;

// Open a context menu anchored at the given screen position (typically the cursor).
// Any currently-open popovers are closed first so successive right-clicks don't stack menus.
export function openMenu(x: number, y: number, actions: MenuAction[]): void {
    if (actions.length === 0) return;
    closeAllPopovers();
    const height = PAD * 2 + actions.length * ITEM_H + Math.max(0, actions.length - 1) * GAP;
    const content: Element = Col({
        style: { padding: PAD, gap: GAP },
        children: actions.map((a) =>
            Button({
                text: a.label,
                style: { width: { kind: "grow" }, height: { kind: "px", value: ITEM_H } },
                onClick: () => {
                    closeAllPopovers();
                    a.onClick();
                },
            })
        ),
    });
    // 0×0 anchor at the cursor for positioning. Context menus have no re-clickable trigger so
    // the anchor-exclusion close guard isn't useful — the off-screen `excludeAnchor` flag opts
    // out so a left-click anywhere (including the original cursor pixel) cleanly closes the menu.
    openPopover({
        anchor: { x, y, w: 0, h: 0 },
        excludeAnchor: false,
        content,
        width: MENU_WIDTH,
        height,
    });
}
