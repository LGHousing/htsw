import { Colors } from "./colors";

export type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};

export type TextField = {
    id: string;
    label: string;
    value: string;
    displayValue?: string;
    rect: Rect;
};

export type LayoutChild =
    | { kind: "fixed"; w: number }
    | { kind: "flex"; minW: number };

/**
 * Standard UI element heights. Use these everywhere instead of literals so
 * buttons and fields line up across the dashboard.
 *
 * - ACTION_BUTTON_H: top/bottom/browser-toolbar buttons (and toggles).
 * - COMPACT_BUTTON_H: list-row / filter-rail / context-menu items.
 * - FIELD_H: text inputs (label line + value line).
 */
export const Heights = {
    actionButton: 22,
    compactButton: 20,
    field: 28,
};

export const Glyphs = {
    add: "+",
    remove: "x",
    refresh: "↻", // ↻
    export: "⤴", // ⤴
    dotFilled: "●", // ●
    dotHalf: "◐", // ◐
    dotEmpty: "○", // ○
    dropdown: "▾", // ▾
    up: "▴", // ▴
    folder: "/",
    file: "·", // ·
    open: "↗", // ↗
    edit: "✎", // ✎
    init: "{}",
};

export function contains(rect: Rect, x: number, y: number): boolean {
    const pad = 2;
    return (
        x >= rect.x - pad &&
        x <= rect.x + rect.w + pad &&
        y >= rect.y - pad &&
        y <= rect.y + rect.h + pad
    );
}

export function drawPanel(rect: Rect): void {
    Renderer.drawRect(Colors.panel, rect.x, rect.y, rect.w, rect.h);
}

export function drawButton(
    gui: Gui,
    rect: Rect,
    label: string,
    enabled: boolean = true,
    hovered: boolean = false
): void {
    Renderer.drawRect(
        enabled ? (hovered ? Colors.hover : Colors.panelSoft) : 0x88505050,
        rect.x,
        rect.y,
        rect.w,
        rect.h
    );
    Renderer.drawRect(
        hovered && enabled ? 0xffd7f264 : Colors.borderRect,
        rect.x,
        rect.y,
        rect.w,
        1
    );
    gui.drawString(label, rect.x + 6, rect.y + 6, enabled ? Colors.text : Colors.muted);
}

export function drawToggle(
    gui: Gui,
    rect: Rect,
    label: string,
    on: boolean,
    hovered: boolean = false
): void {
    Renderer.drawRect(
        on
            ? hovered
                ? 0xdd486a3e
                : 0xaa36512d
            : hovered
              ? Colors.hover
              : Colors.panelSoft,
        rect.x,
        rect.y,
        rect.w,
        rect.h
    );
    gui.drawString(
        `${on ? "[x]" : "[ ]"} ${label}`,
        rect.x + 6,
        rect.y + 6,
        on ? Colors.accent : Colors.text
    );
}

export function drawTextField(
    gui: Gui,
    field: TextField,
    focused: boolean,
    hovered: boolean = false
): void {
    Renderer.drawRect(
        focused ? 0xcc273348 : hovered ? Colors.hover : Colors.panelSoft,
        field.rect.x,
        field.rect.y,
        field.rect.w,
        field.rect.h
    );
    Renderer.drawRect(
        focused ? 0xff67a7e8 : Colors.borderRect,
        field.rect.x,
        field.rect.y,
        field.rect.w,
        1
    );
    gui.drawString(field.label, field.rect.x + 5, field.rect.y + 4, Colors.muted);
    const value = field.displayValue ?? field.value;
    const capacity = textFieldCapacity(field);
    gui.drawString(
        trimMiddle(value, capacity),
        field.rect.x + 5,
        field.rect.y + 14,
        Colors.text
    );
    if (focused) {
        const cursorX = Math.min(
            field.rect.x + field.rect.w - 5,
            field.rect.x + 6 + Math.min(value.length, capacity) * 6
        );
        Renderer.drawRect(Colors.blue, cursorX, field.rect.y + 14, 1, 9);
    }
}

export function shortHash(hash: string | undefined): string {
    if (!hash) return "-";
    return hash.length <= 10 ? hash : hash.slice(0, 10);
}

export function trimText(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;
    if (maxChars <= 3) return value.slice(0, maxChars);
    return value.slice(0, maxChars - 3) + "...";
}

function trimMiddle(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;
    if (maxChars <= 5) return trimText(value, maxChars);
    const start = Math.ceil((maxChars - 3) / 2);
    const end = Math.floor((maxChars - 3) / 2);
    return value.slice(0, start) + "..." + value.slice(value.length - end);
}

function textFieldCapacity(field: TextField): number {
    return Math.max(8, Math.floor(field.rect.w / 6));
}

/**
 * Lays out children left-to-right between [startX, endX] with a `gap` between
 * each. `fixed` children consume `w`. `flex` children share the residue
 * proportionally, never going below their `minW`. If the total minimum width
 * exceeds the available space, every child clamps to its min/fixed width and
 * the row may overflow `endX` — callers should trim labels.
 */
export function layoutRow(
    startX: number,
    endX: number,
    y: number,
    h: number,
    gap: number,
    children: LayoutChild[]
): Rect[] {
    const total = endX - startX;
    let fixedSum = 0;
    let minSum = 0;
    let flexCount = 0;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.kind === "fixed") fixedSum += child.w;
        else {
            minSum += child.minW;
            flexCount++;
        }
    }
    const gapSum = children.length > 1 ? gap * (children.length - 1) : 0;
    const residue = Math.max(0, total - fixedSum - minSum - gapSum);
    const flexExtra = flexCount > 0 ? Math.floor(residue / flexCount) : 0;

    const rects: Rect[] = [];
    let cursor = startX;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const w = child.kind === "fixed" ? child.w : child.minW + flexExtra;
        rects.push({ x: cursor, y, w, h });
        cursor += w + gap;
    }
    return rects;
}

/**
 * Buffer a tooltip near the cursor. The runtime is expected to flush the
 * buffer last in drawDashboard so tooltips paint above all panels.
 */
export function drawTipUnder(
    runtime: { tooltips: { x: number; y: number; text: string }[] },
    mouseX: number,
    mouseY: number,
    text: string
): void {
    runtime.tooltips.push({ x: mouseX + 10, y: mouseY + 10, text });
}

/**
 * Render every buffered tooltip as a small dim panel and clear the buffer.
 */
export function flushTooltips(runtime: {
    gui: Gui;
    tooltips: { x: number; y: number; text: string }[];
}): void {
    const screenW = Renderer.screen.getWidth();
    const screenH = Renderer.screen.getHeight();
    for (let i = 0; i < runtime.tooltips.length; i++) {
        const tip = runtime.tooltips[i];
        const w = Math.min(screenW - 12, tip.text.length * 6 + 8);
        const h = 14;
        const x = Math.min(Math.max(2, tip.x), screenW - w - 2);
        const y = Math.min(Math.max(2, tip.y), screenH - h - 2);
        Renderer.drawRect(0xee0a0d12, x, y, w, h);
        Renderer.drawRect(0xff596270, x, y, w, 1);
        runtime.gui.drawString(trimText(tip.text, Math.floor((w - 8) / 6)), x + 4, y + 3, Colors.text);
    }
    runtime.tooltips = [];
}
