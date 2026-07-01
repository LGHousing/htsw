/// <reference types="../../../../CTAutocomplete" />

/**
 * Import-tab action surfaces: the export destination picker popover, the
 * bottom Import action, and the export destination picker. Pure UI — all
 * state lives elsewhere.
 */

import type { Element } from "../../lib/layout";
import { Button, Col, Container, Icon, Row, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    ACCENT_SUCCESS,
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
import { closeAllPopovers } from "../../lib/popovers";
import { compactFileLabel, normalizeHtswPath, shortPath } from "../../lib/pathDisplay";
import {
    getExportImportJsonPath,
    getHousingUuid,
    getImportJsonPath,
    isParseInProgress,
    setExportImportJsonPath,
} from "../../state";
import { getQueueLength } from "./queue";
import { addRecent, getRecents } from "../../persistence/recents";
import { forEachCachedParse } from "../../parsing/parses";
import { openFileBrowserWithImportJsonSelection } from "../../popovers/file-browser";
import { openNewProjectPopover } from "../../popovers/new-project";
import { getAlias } from "../../../importCache/aliases";
import { boundImportJsonPath } from "../../../importCache/houseBindings";
import { startImport } from "./taskController";
import { createEmptyProjectFiles } from "htsw-editor-common/project";
import { ctProjectFs } from "../../../project/projectFs";

import { PROJECTS_ROOT } from "../../../project/paths";

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

// Create `<projects>/<name>/import.json` and select it as the export
// destination, so the new project is immediately usable from this picker.
function createExportProject(name: string): void {
    try {
        const result = createEmptyProjectFiles(ctProjectFs, PROJECTS_ROOT, name);
        selectExportImportJson(result.importJsonPath);
        closeAllPopovers();
        ChatLib.chat(`&a[htsw] ${result.created ? "Created" : "Selected"} ${result.importJsonPath}`);
    } catch (err) {
        ChatLib.chat(`&c[htsw] New project failed: ${err}`);
    }
}

function pushUniquePath(out: string[], path: string): void {
    const norm = normalizeHtswPath(path);
    if (norm.trim() === "") return;
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

function destinationRow(path: string, boundPath: string | null): Element {
    const selected = normalizeHtswPath(path) === normalizeHtswPath(getExportImportJsonPath());
    const bound = boundPath !== null && normalizeHtswPath(path) === boundPath;
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
                text: compactFileLabel(path),
                color: bound ? ACCENT_SUCCESS : COLOR_TEXT,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            Text({
                text: shortPath(path),
                color: COLOR_TEXT_DIM,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            ...(bound
                ? [
                      Icon({
                          name: Icons.house,
                          color: ACCENT_SUCCESS,
                          tooltip: "Bound to this house",
                          tooltipColor: COLOR_TEXT_DIM,
                          style: { width: { kind: "px", value: 10 }, height: { kind: "px", value: 10 } },
                      }),
                  ]
                : []),
        ],
    });
}

export function exportDestinationPicker(): Element {
    const open = currentExportDestinations();
    const recents = getRecents();
    const uuid = getHousingUuid();
    const rawBound = uuid !== null ? boundImportJsonPath(uuid) : null;
    const boundPath = rawBound !== null ? normalizeHtswPath(rawBound) : null;
    const row = (path: string) => destinationRow(path, boundPath);
    return Col({
        style: { gap: 3, padding: 4, height: { kind: "grow" } },
        children: [
            destinationSection("Open import.jsons"),
            ...open.map(row),
            destinationSection("Recent"),
            ...(recents.length === 0
                ? [
                      Text({
                          text: "(none)",
                          color: COLOR_TEXT_FAINT,
                          style: { padding: { side: "x", value: 8 } },
                      }),
                  ]
                : recents.map(row)),
            Container({ style: { height: { kind: "grow" } }, children: [] }),
            Row({
                style: { gap: 4, height: { kind: "px", value: 20 } },
                children: [
                    Button({
                        icon: Icons.folderPlus,
                        text: "New project",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: () => openNewProjectPopover(aliasPrefill(), createExportProject),
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

export function importControl(): Element {
    const importDisabled = (): boolean => getQueueLength() === 0 || isParseInProgress();
    const importTooltip = (): string => {
        if (isParseInProgress()) return "Project is still loading. Import will be available when it finishes.";
        if (getQueueLength() === 0) return "No changes queued to import.";
        return "Import queued changes.";
    };

    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 } },
        children: [
            Button({
                icon: Icons.upload,
                text: () => {
                    const n = getQueueLength();
                    return n === 0 ? "Import" : `Import (${n})`;
                },
                disabled: importDisabled,
                tooltip: importTooltip,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON_PRIMARY,
                    hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                },
                onClick: () => startImport(),
            }),
        ],
    });
}
