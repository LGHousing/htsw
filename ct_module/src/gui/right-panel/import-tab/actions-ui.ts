/// <reference types="../../../../CTAutocomplete" />

/**
 * Import-tab action surfaces: the destination picker popover, the capture
 * type menu, the bottom action row (Capture / Import / caret), and the
 * caret popover content. Pure UI — all state lives elsewhere.
 */

import type { Element } from "../../lib/layout";
import { Button, Col, Container, Icon, Row, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_DANGER,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_BUTTON_HOVER,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_ROW_SELECTED,
    COLOR_ROW_SELECTED_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    SIZE_ROW_H,
} from "../../lib/theme";
import { closeAllPopovers, togglePopover } from "../../lib/popovers";
import { normalizeHtswPath } from "../../lib/pathDisplay";
import {
    getCheckedImportableCount,
    getCheckedImportableKeys,
    clearImportableChecks,
    getExportImportJsonPath,
    getImportJsonPath,
    setExportImportJsonPath,
} from "../../state";
import { addToQueue, getQueueLength } from "../../state/queue";
import { addRecent, getRecents } from "../../state/recents";
import { forEachCachedParse } from "../../state/parses";
import { openFileBrowserWithImportJsonSelection } from "../../popovers/file-browser";
import {
    CAPTURE_TYPES,
    queueItemsForCheckedKeys,
    startCaptureExport,
    startExportAllFunctions,
    startImport,
    stopAllTasks,
} from "./actions";

// ── Path helpers (used only by the destination picker) ────────────────

function dirOfPath(p: string): string {
    const norm = p.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}

function shortPath(p: string): string {
    const norm = normalizeHtswPath(p).split("\\").join("/");
    const parts = norm.split("/");
    if (parts.length <= 4) return norm;
    return `.../${parts.slice(parts.length - 4).join("/")}`;
}

function basename(p: string): string {
    const norm = p.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? norm : norm.substring(slash + 1);
}

// ── Destination state helpers ──────────────────────────────────────────

function selectExportImportJson(path: string): void {
    setExportImportJsonPath(path);
    addRecent(path);
}

function pushUniquePath(out: string[], path: string): void {
    const norm = normalizeHtswPath(path);
    for (let i = 0; i < out.length; i++) {
        if (out[i] === norm) return;
    }
    out.push(norm);
}

function currentExportDestinations(): string[] {
    const out: string[] = [];
    pushUniquePath(out, getImportJsonPath());
    forEachCachedParse((entry) => {
        pushUniquePath(out, entry.canonicalPath);
    });
    return out;
}

// ── Popover contents + the action row ─────────────────────────────────

function destinationSection(label: string): Element {
    return Text({
        text: label,
        color: COLOR_TEXT_FAINT,
        style: { padding: { side: "x", value: 4 } },
    });
}

function destinationRow(path: string): Element {
    const selected = normalizeHtswPath(path) === normalizeHtswPath(getExportImportJsonPath());
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 8 },
            gap: 6,
            height: { kind: "px", value: SIZE_ROW_H },
            background: selected ? COLOR_ROW_SELECTED : COLOR_ROW,
            hoverBackground: selected ? COLOR_ROW_SELECTED_HOVER : COLOR_ROW_HOVER,
        },
        onClick: () => {
            selectExportImportJson(path);
            closeAllPopovers();
        },
        children: [
            Icon({ name: selected ? Icons.check : Icons.fileJson }),
            Text({
                text: basename(path),
                color: COLOR_TEXT,
                style: { width: { kind: "px", value: 96 } },
            }),
            Text({
                text: shortPath(path),
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

function captureDestinationPicker(): Element {
    const open = currentExportDestinations();
    const recents = getRecents();
    return Col({
        style: { gap: 3, padding: 4, height: { kind: "grow" } },
        children: [
            destinationSection("Open import.jsons"),
            ...open.map(destinationRow),
            destinationSection("Recent"),
            ...(recents.length === 0
                ? [
                      Text({
                          text: "(none)",
                          color: COLOR_TEXT_FAINT,
                          style: { padding: { side: "x", value: 8 } },
                      }),
                  ]
                : recents.map(destinationRow)),
            Button({
                icon: Icons.search,
                text: "Browse...",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 20 },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => {
                    const current = getExportImportJsonPath();
                    closeAllPopovers();
                    openFileBrowserWithImportJsonSelection(
                        dirOfPath(current) || ".",
                        (path) => selectExportImportJson(path)
                    );
                },
            }),
        ],
    });
}

function captureMenuPopoverContent(): Element {
    return Col({
        style: { gap: 2, padding: 4 },
        children: [
            Row({
                style: { gap: 4, height: { kind: "px", value: SIZE_ROW_H } },
                children: [
                    Text({
                        text: () => shortPath(getExportImportJsonPath()),
                        color: COLOR_TEXT_DIM,
                        style: { width: { kind: "grow" } },
                    }),
                    Button({
                        text: "Change",
                        style: {
                            width: { kind: "px", value: 56 },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: (rect) =>
                            togglePopover({
                                key: "right-capture-destination-menu",
                                anchor: rect,
                                content: captureDestinationPicker(),
                                width: 360,
                                height: 220,
                            }),
                    }),
                ],
            }),
            ...CAPTURE_TYPES.map((t) =>
                Container({
                    style: {
                        direction: "row",
                        align: "center",
                        padding: { side: "x", value: 8 },
                        gap: 6,
                        height: { kind: "px", value: SIZE_ROW_H },
                        background: COLOR_ROW,
                        hoverBackground: COLOR_ROW_HOVER,
                    },
                    onClick: () => startCaptureExport(t),
                    children: [
                        Text({
                            text: `Capture ${t}`,
                            color: COLOR_TEXT,
                            style: { width: { kind: "grow" } },
                        }),
                    ],
                })
            ),
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: { side: "x", value: 8 },
                    gap: 6,
                    height: { kind: "px", value: SIZE_ROW_H },
                    background: COLOR_ROW,
                    hoverBackground: COLOR_ROW_HOVER,
                },
                onClick: () => startExportAllFunctions(),
                children: [
                    Text({
                        text: "Export All Functions",
                        color: COLOR_TEXT,
                        style: { width: { kind: "grow" } },
                    }),
                ],
            }),
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: { side: "x", value: 8 },
                    gap: 6,
                    height: { kind: "px", value: SIZE_ROW_H },
                    background: COLOR_BUTTON_DANGER,
                    hoverBackground: COLOR_BUTTON_DANGER_HOVER,
                },
                onClick: () => stopAllTasks(),
                children: [
                    Text({
                        text: "Stop",
                        color: COLOR_TEXT,
                        style: { width: { kind: "grow" } },
                    }),
                ],
            }),
        ],
    });
}

function importCaretPopoverContent(): Element {
    return Col({
        style: { padding: 4, gap: 2, height: { kind: "grow" } },
        children: [
            Button({
                text: () => `Add selected to queue (${getCheckedImportableCount()})`,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 20 },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => {
                    const items = queueItemsForCheckedKeys(getCheckedImportableKeys());
                    let added = 0;
                    for (let i = 0; i < items.length; i++) {
                        if (addToQueue(items[i])) added++;
                    }
                    closeAllPopovers();
                    ChatLib.chat(`&a[htsw] Added ${added} to queue.`);
                },
            }),
            Button({
                text: "Clear selection",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 20 },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => {
                    clearImportableChecks();
                    closeAllPopovers();
                },
            }),
        ],
    });
}

export function importActionRow(): Element {
    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 } },
        children: [
            Button({
                // Capture pulls server → user, hence `download`. Chevron-down
                // keeps the "this opens a menu" affordance.
                children: [
                    Icon({ name: Icons.download }),
                    Text({ text: "Capture" }),
                    Icon({ name: Icons.chevronDown }),
                ],
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: (rect) =>
                    togglePopover({
                        key: "right-capture-type-menu",
                        anchor: rect,
                        content: captureMenuPopoverContent(),
                        width: 260,
                        height: (CAPTURE_TYPES.length + 3) * 20 + 8,
                    }),
            }),
            Button({
                icon: Icons.upload,
                text: () => {
                    const n = getQueueLength();
                    return n === 0 ? "Import" : `Import (${n})`;
                },
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON_PRIMARY,
                    hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                },
                onClick: () => startImport(),
            }),
            // Caret: alternate-source actions (selected-only import, clear selection).
            Button({
                icon: Icons.chevronDown,
                style: {
                    width: { kind: "px", value: 22 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON_PRIMARY,
                    hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                },
                onClick: (rect) => {
                    togglePopover({
                        key: "right-import-caret-menu",
                        anchor: rect,
                        content: importCaretPopoverContent(),
                        width: 200,
                        height: 56,
                    });
                },
            }),
        ],
    });
}
