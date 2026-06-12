import { Element } from "../lib/layout";
import { Button, Col, Row, Text } from "../lib/components";
import { closePopover, openPopover, type PopoverHandle } from "../lib/popovers";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_DANGER,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_BUTTON_HOVER,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
} from "../lib/theme";

/**
 * Modal yes/no confirmation. The modal scrim blocks everything behind it, so
 * a misclick can't fall through to the panel — use this for destructive or
 * surprising actions instead of a "confirm" context-menu entry.
 */

let activeHandle: PopoverHandle | null = null;

const PAD = 8;
const LINE_H = 11;
const TITLE_H = 12;
const BUTTON_ROW_H = 18;
const MIN_WIDTH = 240;
const MAX_WIDTH = 380;

// Fit the widest line (MC's font is proportional, so a fixed width either
// wastes space or lets a long line spill past the box). Truncation on the
// Text rows is the backstop for lines longer than MAX_WIDTH.
function fitWidth(title: string, lines: string[]): number {
    let w = Renderer.getStringWidth(title);
    for (let i = 0; i < lines.length; i++) {
        w = Math.max(w, Renderer.getStringWidth(lines[i]));
    }
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w + PAD * 2 + 4));
}

export type ConfirmOptions = {
    title: string;
    /** Body lines, one Text row each. Keep them short — no wrapping. */
    lines?: string[];
    confirmLabel?: string;
    cancelLabel?: string;
    /** Danger-tints the confirm button for destructive actions. */
    danger?: boolean;
    onConfirm: () => void;
};

function closeSelf(): void {
    if (activeHandle !== null) {
        closePopover(activeHandle);
        activeHandle = null;
    }
}

function content(opts: ConfirmOptions): Element {
    const lines = opts.lines ?? [];
    return Col({
        style: { padding: PAD, gap: 4 },
        children: [
            Text({ text: opts.title, color: COLOR_TEXT, truncate: true }),
            ...lines.map((l) => Text({ text: l, color: COLOR_TEXT_DIM, truncate: true })),
            Row({
                style: { gap: 4, height: { kind: "px", value: BUTTON_ROW_H } },
                children: [
                    Button({
                        text: opts.confirmLabel ?? "Confirm",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: opts.danger === true ? COLOR_BUTTON_DANGER : COLOR_BUTTON_PRIMARY,
                            hoverBackground:
                                opts.danger === true
                                    ? COLOR_BUTTON_DANGER_HOVER
                                    : COLOR_BUTTON_PRIMARY_HOVER,
                        },
                        onClick: () => {
                            closeSelf();
                            opts.onConfirm();
                        },
                    }),
                    Button({
                        text: opts.cancelLabel ?? "Cancel",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: () => closeSelf(),
                    }),
                ],
            }),
        ],
    });
}

export function openConfirmPopover(opts: ConfirmOptions): void {
    closeSelf();
    const lines = opts.lines ?? [];
    const height = PAD * 2 + TITLE_H + lines.length * LINE_H + 4 + BUTTON_ROW_H + 4;
    activeHandle = openPopover({
        anchor: { x: 0, y: 0, w: 0, h: 0 },
        content: content(opts),
        width: fitWidth(opts.title, lines),
        height,
        key: "confirm",
        placement: "modal",
        onClose: () => {
            activeHandle = null;
        },
    });
}
