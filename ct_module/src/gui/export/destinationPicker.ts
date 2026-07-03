/// <reference types="../../../CTAutocomplete" />

import type { Element } from "../lib/layout";
import { Button, Col, Container, Icon, Row, Text } from "../lib/components";
import { Icons } from "../lib/icons.generated";
import {
    ACCENT_SUCCESS,
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_ROW_SELECTED,
    COLOR_ROW_SELECTED_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    SIZE_ROW_H,
} from "../lib/theme";
import { closeAllPopovers } from "../lib/popovers";
import { compactFileLabel, normalizeHtswPath, shortPath } from "../lib/pathDisplay";
import {
    getExportImportJsonPath,
    getHousingUuid,
    getImportJsonPath,
    setExportImportJsonPath,
} from "../state";
import { addRecent, getRecents } from "../persistence/recents";
import { forEachCachedParse, markParseStale } from "../parsing/parses";
import { openFileBrowserWithImportJsonSelection } from "../popovers/file-browser";
import { openConfirmPopover } from "../popovers/confirm";
import { openNewProjectPopover } from "./newProjectPopover";
import { showToast } from "../toast";
import { getAlias } from "../../importCache/aliases";
import { boundImportJsonPath } from "../../importCache/houseBindings";
import { createEmptyProjectFiles } from "htsw-editor-common/project";
import { ctProjectFs } from "../../project/projectFs";
import {
    PROJECTS_ROOT,
    parentDirOf,
    projectPathExists,
    projectSectionFolders,
    restructureProjectPerSection,
} from "../../project/paths";

function selectExportImportJson(path: string): void {
    setExportImportJsonPath(path);
    addRecent(path);
}

function aliasPrefill(): string {
    const uuid = getHousingUuid();
    const alias = uuid !== null ? getAlias(uuid) : null;
    return alias !== null ? alias.split(" ").join("") : "";
}

function createExportProject(name: string, sectionFolders: boolean): void {
    try {
        const result = createEmptyProjectFiles(ctProjectFs, PROJECTS_ROOT, name, {
            sectionFolders,
        });
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

function splitIntoSectionFolders(importJsonPath: string): void {
    try {
        const result = restructureProjectPerSection(importJsonPath);
        markParseStale(importJsonPath);
        const moved = result.moved.length;
        if (result.failures.length > 0) {
            for (const failure of result.failures) {
                ChatLib.chat(
                    `&c[htsw] ${failure.section} '${failure.identity}': ${failure.message}`
                );
            }
            showToast(
                `Split finished with ${result.failures.length} failed, ${moved} moved`,
                0xffe85c5c,
                8000
            );
            return;
        }
        showToast(
            `Split ${shortPath(importJsonPath)} into folders — ${moved} importable${moved === 1 ? "" : "s"} moved`,
            0xff5cb85c
        );
    } catch (err) {
        showToast(`Split failed: ${err}`, 0xffe85c5c, 8000);
    }
}

// Where a NEW export lands for the current destination, stated instead of
// implied: re-exports always follow the file that already declares them.
function destinationPreviewRow(): Element | false {
    const dest = getExportImportJsonPath();
    if (dest.trim() === "" || !projectPathExists(dest)) return false;
    const perSection = projectSectionFolders(dest).length > 0;
    const dir = shortPath(parentDirOf(dest));
    return Row({
        style: { gap: 4, align: "center", height: { kind: "px", value: 20 } },
        children: [
            Text({
                text: perSection
                    ? `New exports → ${dir}/<type>/`
                    : `New exports → ${dir}/`,
                color: COLOR_TEXT_DIM,
                truncate: true,
                style: { width: { kind: "grow" }, padding: { side: "x", value: 4 } },
            }),
            ...(perSection
                ? []
                : [
                      Button({
                          icon: Icons.folderTree,
                          text: "Split into folders…",
                          style: {
                              height: { kind: "grow" },
                              background: COLOR_BUTTON,
                              hoverBackground: COLOR_BUTTON_HOVER,
                          },
                          tooltip: "Move this project's importables into a folder per type",
                          tooltipColor: COLOR_TEXT_DIM,
                          onClick: () =>
                              openConfirmPopover({
                                  title: `Split ${compactFileLabel(dest)} into folders?`,
                                  lines: [
                                      "Creates functions/, events/, … each with its own import.json,",
                                      "moves the root file's importables and their files into them,",
                                      "and sorts future exports into those folders.",
                                  ],
                                  confirmLabel: "Split",
                                  onConfirm: () => {
                                      closeAllPopovers();
                                      splitIntoSectionFolders(dest);
                                  },
                              }),
                      }),
                  ]),
        ],
    });
}

export function exportDestinationPicker(): Element {
    const open = currentExportDestinations();
    const recents = getRecents().filter((path) => {
        const norm = normalizeHtswPath(path);
        return open.indexOf(norm) < 0;
    });
    const uuid = getHousingUuid();
    const rawBound = uuid !== null ? boundImportJsonPath(uuid) : null;
    const boundPath = rawBound !== null ? normalizeHtswPath(rawBound) : null;
    const row = (path: string) => destinationRow(path, boundPath);
    return Col({
        style: { gap: 3, padding: 4, height: { kind: "grow" } },
        children: [
            destinationSection("Open import.jsons"),
            ...open.map(row),
            ...(recents.length === 0
                ? []
                : [destinationSection("Recent"), ...recents.map(row)]),
            Container({ style: { height: { kind: "grow" } }, children: [] }),
            destinationPreviewRow(),
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
