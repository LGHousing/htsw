/// <reference types="../../../../CTAutocomplete" />

import type { ImportConflict } from "../../../importables/import/conflicts";
import {
    resolveSelectedImportConflicts,
    type ImportConflictResolution,
} from "../../../importables/import/conflictResolution";
import { actionSyncConflictIdentifier } from "../../../housingSync/actions/syncContext";
import type { Element } from "../../lib/layout";
import { Button, Col, Row, Scroll, Text } from "../../lib/components";
import { closePopover, openPopover, type PopoverHandle } from "../../lib/popovers";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_DANGER,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_BUTTON_HOVER,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
} from "../../lib/theme";

export type ConflictResolutionDecision =
    | { kind: "resolved"; resolution: ImportConflictResolution }
    | { kind: "review" }
    | { kind: "cancel" };

export type ConflictResolutionPopoverOptions = {
    conflicts: readonly ImportConflict[];
    label: (conflict: ImportConflict) => string;
    onDecision: (decision: ConflictResolutionDecision) => void;
};

const PAD = 8;
const GAP = 4;
const TEXT_H = 8;
const ROW_H = 18;
const BUTTON_ROW_H = 18;
const MIN_WIDTH = 360;
const MAX_WIDTH = 480;
const MIN_VISIBLE_ROWS = 3;
const MAX_VISIBLE_ROWS = 10;

let activeHandle: PopoverHandle | null = null;

function closeSelf(): void {
    if (activeHandle === null) return;
    const handle = activeHandle;
    activeHandle = null;
    closePopover(handle);
}

export function closeConflictResolutionPopover(): void {
    closeSelf();
}

function fitWidth(
    conflicts: readonly ImportConflict[],
    label: (conflict: ImportConflict) => string
): number {
    let width = Renderer.getStringWidth("Choose which Housing changes to overwrite");
    for (const conflict of conflicts) {
        width = Math.max(
            width,
            Renderer.getStringWidth(label(conflict)) +
                Renderer.getStringWidth("[ ] Skip") +
                PAD * 2
        );
    }
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width + PAD * 2 + 4));
}

function content(
    opts: ConflictResolutionPopoverOptions,
    acceptedIdentifiers: Set<string>,
    finish: (decision: ConflictResolutionDecision) => void
): Element {
    const rows = opts.conflicts.map((conflict) => {
        const identifier = actionSyncConflictIdentifier(conflict);
        const isAccepted = (): boolean => acceptedIdentifiers.has(identifier);
        return Button({
            children: [
                Text({
                    text: opts.label(conflict),
                    color: COLOR_TEXT,
                    truncate: true,
                    style: { width: { kind: "grow" } },
                }),
                Text({
                    text: () => (isAccepted() ? "[x] Import" : "[ ] Skip"),
                    color: COLOR_TEXT,
                    style: { width: { kind: "px", value: 52 } },
                }),
            ],
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: ROW_H },
                justify: "start",
                background: () =>
                    isAccepted() ? COLOR_BUTTON_DANGER : COLOR_BUTTON,
                hoverBackground: () =>
                    isAccepted() ? COLOR_BUTTON_DANGER_HOVER : COLOR_BUTTON_HOVER,
            },
            onClick: () => {
                if (isAccepted()) acceptedIdentifiers.delete(identifier);
                else acceptedIdentifiers.add(identifier);
            },
        });
    });

    return Col({
        style: { padding: PAD, gap: GAP, height: { kind: "grow" } },
        children: [
            Text({
                text: "Choose which Housing changes to overwrite",
                color: COLOR_TEXT,
                truncate: true,
            }),
            Text({
                text: "Selected lists use the import; unselected lists stay in Housing.",
                color: COLOR_TEXT_DIM,
                truncate: true,
            }),
            Scroll({
                id: "import-conflict-resolution-list",
                style: { gap: 2, height: { kind: "grow" } },
                children: rows,
            }),
            Row({
                style: { gap: GAP, height: { kind: "px", value: BUTTON_ROW_H } },
                children: [
                    Button({
                        text: () =>
                            acceptedIdentifiers.size === 0
                                ? "Skip all"
                                : "Apply choices",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON_PRIMARY,
                            hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                        },
                        onClick: () =>
                            finish({
                                kind: "resolved",
                                resolution: resolveSelectedImportConflicts(
                                    opts.conflicts,
                                    acceptedIdentifiers
                                ),
                            }),
                    }),
                    Button({
                        text: "Import all",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON_DANGER,
                            hoverBackground: COLOR_BUTTON_DANGER_HOVER,
                        },
                        onClick: () =>
                            finish({
                                kind: "resolved",
                                resolution: {
                                    accepted: opts.conflicts.slice(),
                                    skipped: [],
                                },
                            }),
                    }),
                    Button({
                        text: "See changes",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                        },
                        onClick: () => finish({ kind: "review" }),
                    }),
                    Button({
                        text: "Cancel",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                        },
                        onClick: () => finish({ kind: "cancel" }),
                    }),
                ],
            }),
        ],
    });
}

export function openConflictResolutionPopover(
    opts: ConflictResolutionPopoverOptions
): void {
    closeSelf();
    const acceptedIdentifiers = new Set<string>();
    let handled = false;
    const finish = (decision: ConflictResolutionDecision): void => {
        if (handled) return;
        handled = true;
        closeSelf();
        opts.onDecision(decision);
    };
    const visibleRows = Math.max(
        MIN_VISIBLE_ROWS,
        Math.min(MAX_VISIBLE_ROWS, opts.conflicts.length)
    );
    const height =
        PAD * 2 +
        TEXT_H * 2 +
        GAP * 3 +
        visibleRows * ROW_H +
        Math.max(0, visibleRows - 1) * 2 +
        BUTTON_ROW_H;
    activeHandle = openPopover({
        anchor: { x: 0, y: 0, w: 0, h: 0 },
        content: content(opts, acceptedIdentifiers, finish),
        width: fitWidth(opts.conflicts, opts.label),
        height,
        key: "import-conflict-resolution",
        placement: "modal",
        onClose: () => {
            activeHandle = null;
            if (!handled) finish({ kind: "cancel" });
        },
    });
}
