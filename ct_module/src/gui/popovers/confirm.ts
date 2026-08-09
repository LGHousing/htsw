import { Element } from "../lib/layout";
import { Button, Col, Row, Scroll, Text } from "../lib/components";
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
const GAP = 4;
const TEXT_H = 8;
const BUTTON_ROW_H = 18;
const BUTTON_PAD_X = 8;
const MIN_WIDTH = 240;
const MAX_WIDTH = 380;
const MAX_VISIBLE_LINES = 10;

// Fit the widest line (MC's font is proportional, so a fixed width either
// wastes space or lets a long line spill past the box). Truncation on the
// Text rows is the backstop for lines longer than MAX_WIDTH.
function fitWidth(title: string, lines: string[], buttonLabels: string[]): number {
    let w = Renderer.getStringWidth(title);
    for (let i = 0; i < lines.length; i++) {
        w = Math.max(w, Renderer.getStringWidth(lines[i]));
    }
    let buttonRowWidth = GAP * Math.max(0, buttonLabels.length - 1);
    for (let i = 0; i < buttonLabels.length; i++) {
        buttonRowWidth += Renderer.getStringWidth(buttonLabels[i]) + BUTTON_PAD_X;
    }
    w = Math.max(w, buttonRowWidth);
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w + PAD * 2 + 4));
}

export type ConfirmOptions = {
    title: string;
    /** Body lines, one Text row each. Keep them short — no wrapping. */
    lines?: string[];
    confirmLabel?: string;
    extraLabel?: string;
    cancelLabel?: string;
    /** Danger-tints the confirm button for destructive actions. */
    danger?: boolean;
    /** Keeps the modal open until one of its own buttons is clicked. */
    sticky?: boolean;
    onConfirm: () => void;
    onExtra?: () => void;
    onCancel?: () => void;
    onClose?: () => void;
};

function closeSelf(): void {
    if (activeHandle !== null) {
        closePopover(activeHandle);
        activeHandle = null;
    }
}

export function closeConfirmPopover(): void {
    closeSelf();
}

function buttonWidths(labels: string[], popoverWidth: number): number[] {
    const widths = labels.map((label) => Renderer.getStringWidth(label) + BUTTON_PAD_X);
    const rowWidth = popoverWidth - PAD * 2 - GAP * Math.max(0, labels.length - 1);
    const measuredWidth = widths.reduce((sum, width) => sum + width, 0);
    const sparePerButton = Math.max(0, rowWidth - measuredWidth) / labels.length;
    return widths.map((width) => width + sparePerButton);
}

function content(opts: ConfirmOptions, widths: number[]): Element {
    const lines = opts.lines ?? [];
    const lineElements = lines.map((line) =>
        Text({ text: line, color: COLOR_TEXT_DIM, truncate: true })
    );
    const body =
        lines.length > MAX_VISIBLE_LINES
            ? [
                  Scroll({
                      id: "confirm-lines",
                      style: {
                          gap: GAP,
                          height: {
                              kind: "px",
                              value:
                                  MAX_VISIBLE_LINES * TEXT_H +
                                  (MAX_VISIBLE_LINES - 1) * GAP,
                          },
                      },
                      children: lineElements,
                  }),
              ]
            : lineElements;
    return Col({
        style: { padding: PAD, gap: GAP },
        children: [
            Text({ text: opts.title, color: COLOR_TEXT, truncate: true }),
            ...body,
            Row({
                style: { gap: 4, height: { kind: "px", value: BUTTON_ROW_H } },
                children: [
                    Button({
                        text: opts.confirmLabel ?? "Confirm",
                        style: {
                            width: { kind: "px", value: widths[0] },
                            height: { kind: "grow" },
                            background:
                                opts.danger === true
                                    ? COLOR_BUTTON_DANGER
                                    : COLOR_BUTTON_PRIMARY,
                            hoverBackground:
                                opts.danger === true
                                    ? COLOR_BUTTON_DANGER_HOVER
                                    : COLOR_BUTTON_PRIMARY_HOVER,
                        },
                        onClick: opts.onConfirm,
                    }),
                    opts.extraLabel !== undefined &&
                        opts.onExtra !== undefined &&
                        Button({
                            text: opts.extraLabel,
                            style: {
                                width: { kind: "px", value: widths[1] },
                                height: { kind: "grow" },
                                background: COLOR_BUTTON,
                                hoverBackground: COLOR_BUTTON_HOVER,
                            },
                            onClick: opts.onExtra,
                        }),
                    Button({
                        text: opts.cancelLabel ?? "Cancel",
                        style: {
                            width: { kind: "px", value: widths[widths.length - 1] },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: opts.onCancel ?? (() => closeSelf()),
                    }),
                ],
            }),
        ],
    });
}

export function openConfirmPopover(opts: ConfirmOptions): void {
    closeSelf();
    const lines = opts.lines ?? [];
    let handled = false;
    const runAction = (action: () => void): void => {
        if (handled) return;
        handled = true;
        closeSelf();
        action();
    };
    const extraAction = opts.onExtra;
    const cancelAction = opts.onCancel;
    const labels = [
        opts.confirmLabel ?? "Confirm",
        ...(opts.extraLabel !== undefined && opts.onExtra !== undefined
            ? [opts.extraLabel]
            : []),
        opts.cancelLabel ?? "Cancel",
    ];
    const width = fitWidth(opts.title, lines, labels);
    const bodyHeight =
        lines.length > MAX_VISIBLE_LINES
            ? MAX_VISIBLE_LINES * TEXT_H + (MAX_VISIBLE_LINES - 1) * GAP
            : lines.length * TEXT_H;
    const childCount = 2 + (lines.length === 0 ? 0 : 1);
    const gapHeight =
        lines.length > MAX_VISIBLE_LINES
            ? GAP * (childCount - 1)
            : GAP * (lines.length + 1);
    const height = PAD * 2 + TEXT_H + bodyHeight + gapHeight + BUTTON_ROW_H;
    activeHandle = openPopover({
        anchor: { x: 0, y: 0, w: 0, h: 0 },
        content: content(
            {
                ...opts,
                onConfirm: () => runAction(opts.onConfirm),
                onExtra:
                    extraAction === undefined ? undefined : () => runAction(extraAction),
                onCancel:
                    cancelAction === undefined
                        ? undefined
                        : () => runAction(cancelAction),
            },
            buttonWidths(labels, width)
        ),
        width,
        height,
        key: "confirm",
        placement: "modal",
        sticky: opts.sticky,
        onClose: () => {
            activeHandle = null;
            if (!handled) opts.onClose?.();
        },
    });
}
