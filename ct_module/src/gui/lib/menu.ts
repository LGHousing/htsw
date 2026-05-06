/// <reference types="../../CTAutocomplete" />

import { Element } from "./layout";
import { Button, Col, Container } from "./components";
import { closeAllPopovers, openPopover } from "./popovers";
import { COLOR_PANEL_BORDER } from "./theme";

export type MenuAction =
    | { kind?: "action"; label: string; onClick: () => void }
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

function actionElement(a: MenuAction): Element {
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
        style: { width: { kind: "grow" }, height: { kind: "px", value: ITEM_H } },
        onClick: () => {
            closeAllPopovers();
            a.onClick();
        },
    });
}

function menuWidthFor(actions: MenuAction[]): number {
    let maxLabelW = 0;
    for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if (!isAction(a)) continue;
        const w = Renderer.getStringWidth(a.label);
        if (w > maxLabelW) maxLabelW = w;
    }
    const desired = maxLabelW + TEXT_FRAME_W;
    return desired < MIN_MENU_WIDTH ? MIN_MENU_WIDTH : desired;
}

// Open a context menu anchored at the given screen position (typically the cursor).
// Any currently-open popovers are closed first so successive right-clicks don't stack menus.
export function openMenu(x: number, y: number, actions: MenuAction[]): void {
    if (actions.length === 0) return;
    closeAllPopovers();
    let height = PAD * 2;
    for (let i = 0; i < actions.length; i++) {
        height += isAction(actions[i]) ? ITEM_H : SEPARATOR_H;
        if (i > 0) height += GAP;
    }
    const content: Element = Col({
        style: { padding: PAD, gap: GAP },
        children: actions.map(actionElement),
    });
    // 0×0 anchor at the cursor for positioning. Context menus have no re-clickable trigger so
    // the anchor-exclusion close guard isn't useful — the off-screen `excludeAnchor` flag opts
    // out so a left-click anywhere (including the original cursor pixel) cleanly closes the menu.
    openPopover({
        anchor: { x, y, w: 0, h: 0 },
        excludeAnchor: false,
        content,
        width: menuWidthFor(actions),
        height,
    });
}
