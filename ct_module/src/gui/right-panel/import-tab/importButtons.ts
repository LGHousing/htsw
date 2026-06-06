/// <reference types="../../../../CTAutocomplete" />

/**
 * Import-tab action surfaces: the export destination picker popover, the
 * bottom action row (Auto-proceed / Import / caret), and the caret popover
 * content. Pure UI — all state lives elsewhere.
 */

import type { Element } from "../../lib/layout";
import { Button, Col, Container, Icon, Row, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    COLOR_BUTTON,
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
import { normalizeHtswPath, shortPath } from "../../lib/pathDisplay";
import {
    clearImportableChecks,
    getAutoTrackSources,
    getExportImportJsonPath,
    getHousingUuid,
    getImportJsonPath,
    setExportImportJsonPath,
} from "../../state";
import { getQueueLength } from "./queue";
import { addRecent, getRecents } from "../../persistence/recents";
import { forEachCachedParse } from "../../parsing/parses";
import { openFileBrowserWithImportJsonSelection } from "../../popovers/file-browser";
import { openNewFolderPopover } from "../../popovers/new-folder";
import { getAlias } from "../../../importCache/aliases";
import { javaType } from "../../lib/java";
import { getImportProgress } from "./importProgress";
import { getStepAuto, setStepAuto } from "../../../housingSync/stepGate";
import { startImport } from "./importController";

const IMPORTS_ROOT = "./htsw/imports";

// ── Path helpers (used only by the destination picker) ────────────────

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

function aliasPrefill(): string {
    const uuid = getHousingUuid();
    const alias = uuid !== null ? getAlias(uuid) : null;
    return alias !== null ? alias.split(" ").join("") : "";
}

// Create `<imports>/<name>/import.json` and select it as the export
// destination, so the new folder is immediately usable from this picker.
function createExportFolder(name: string): void {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        const dir = `${IMPORTS_ROOT}/${name}`;
        Files.createDirectories(Paths.get(String(dir)));
        const importJson = `${dir}/import.json`;
        if (!FileLib.exists(importJson)) {
            FileLib.write(importJson, "{\n}\n", true);
        }
        selectExportImportJson(importJson);
        closeAllPopovers();
        ChatLib.chat(`&a[htsw] Created ${importJson}`);
    } catch (err) {
        ChatLib.chat(`&c[htsw] New folder failed: ${err}`);
    }
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

export function exportDestinationPicker(): Element {
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
            Container({ style: { height: { kind: "grow" } }, children: [] }),
            Row({
                style: { gap: 4, height: { kind: "px", value: 20 } },
                children: [
                    Button({
                        icon: Icons.folderPlus,
                        text: "New folder",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: () => openNewFolderPopover(aliasPrefill(), createExportFolder),
                    }),
                    Button({
                        icon: Icons.search,
                        text: "Browse...",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: () => {
                            closeAllPopovers();
                            openFileBrowserWithImportJsonSelection(undefined, (path) =>
                                selectExportImportJson(path)
                            );
                        },
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
                text: () => {
                    const n = getAutoTrackSources().size;
                    return n === 0 ? "Auto-Track: OFF" : `Auto-Track: ${n} source${n === 1 ? "" : "s"}`;
                },
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 20 },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => {},
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

// Idle-only: during a run, Pause/Step live in the progress strip, so this
// toggle only sets whether the next import starts in step mode.
function autoProceedButton(): Element {
    return Button({
        text: () => (getStepAuto() ? "Auto-proceed: On" : "Auto-proceed: Off"),
        style: {
            width: { kind: "grow" },
            height: { kind: "grow" },
            background: COLOR_BUTTON,
            hoverBackground: COLOR_BUTTON_HOVER,
        },
        onClick: () => setStepAuto(!getStepAuto()),
    });
}

export function importActionRow(): Element {
    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 } },
        children: [
            ...(getImportProgress() === null ? [autoProceedButton()] : []),
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
