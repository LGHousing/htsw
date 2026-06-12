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
const WIDTH = 280;

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
            Text({ text: opts.title, color: COLOR_TEXT }),
            ...lines.map((l) => Text({ text: l, color: COLOR_TEXT_DIM })),
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
    const lineCount = opts.lines === undefined ? 0 : opts.lines.length;
    const height = PAD * 2 + TITLE_H + lineCount * LINE_H + 4 + BUTTON_ROW_H + 4;
    activeHandle = openPopover({
        anchor: { x: 0, y: 0, w: 0, h: 0 },
        content: content(opts),
        width: WIDTH,
        height,
        key: "confirm",
        placement: "modal",
        onClose: () => {
            activeHandle = null;
        },
    });
}
