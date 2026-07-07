/// <reference types="../../../CTAutocomplete" />

import type { Element } from "../lib/layout";
import { Button, Col, Container, Icon, Row, Scroll, Text } from "../lib/components";
import { Icons } from "../lib/icons.generated";
import { markGuiDirty } from "../lib/dirty";
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
    getEffectiveNewExportTarget,
    getExportImportJsonPath,
    getHousingUuid,
    getImportJsonPath,
    setExportImportJsonPath,
    setNewExportTarget,
} from "../state";
import { addRecent, getRecents } from "../persistence/recents";
import {
    canonicalPath,
    forEachCachedParse,
    invalidateParseCacheEntry,
    markParseStale,
    requestParse,
} from "../parsing/parses";
import { openFileBrowserWithImportJsonSelection } from "../popovers/file-browser";
import { openConfirmPopover } from "../popovers/confirm";
import { openTextPromptPopover } from "../popovers/text-prompt";
import {
    buildPickerNode,
    newPickerRow,
    pickerTreeRows,
    type PickerNode,
} from "../popovers/includeTreePicker";
import type { IncludeNode } from "../left-panel/importables/includeTree";
import { bumpTreeRevision } from "../left-panel/importables/rowModel";
import { openNewProjectPopover } from "./newProjectPopover";
import { showToast } from "../toast";
import { getAlias } from "../../importCache/aliases";
import { boundImportJsonPath } from "../../importCache/houseBindings";
import { createEmptyProjectFiles } from "htsw-editor-common/project";
import { ctProjectFs } from "../../project/projectFs";
import {
    PROJECTS_ROOT,
    createIncludedFolderInTree,
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
        // Selecting a destination keeps the picker open so the "New exports
        // land in" tree below can rebuild for it — the whole point of the
        // revamp is to pick the project AND where new exports land in one place.
        onClick: () => {
            selectExportImportJson(path);
            markGuiDirty();
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

// The sub-target tree (where a new export lands) is rebuilt from the current
// base each time the picker opens; the base's include structure is the set of
// files a new export can be routed into.
const EXPORT_PROJECTS_SCROLL_H = SIZE_ROW_H * 3 + 6;
let exportSubRoots: PickerNode[] = [];
const exportSubExpansion: Set<string> = new Set();
// Signature of what `exportSubRoots` was last built from, so the tree rebuilds
// when the chosen destination changes or its parse warms (the picker stays open
// across those), but not on every frame (which would wipe expansion state).
let exportSubSig = "";

function dirOfPath(p: string): string {
    const s = p.split("\\").join("/");
    const i = s.lastIndexOf("/");
    return i < 0 ? s : s.substring(0, i);
}

function baseIncludeTree(base: string): IncludeNode | null {
    const cached = requestParse(base);
    return cached !== null && cached.parsed !== null ? cached.parsed.importJson.fileTree : null;
}

function exportSubSignature(base: string): string {
    if (base.trim() === "") return "";
    const tree = baseIncludeTree(base);
    return `${base}|${tree !== null ? tree.includes.length : -1}`;
}

function rebuildExportSubTree(base: string): void {
    if (base.trim() === "") {
        exportSubRoots = [];
        return;
    }
    const root = baseIncludeTree(base) ?? { path: base, importables: [], includes: [] };
    const projectDir = dirOfPath(canonicalPath(root.path));
    exportSubRoots = [buildPickerNode(root, projectDir, 0, null)];
    exportSubExpansion.clear();
    for (let i = 0; i < exportSubRoots.length; i++) {
        if (exportSubRoots[i].children.length > 0) exportSubExpansion.add(exportSubRoots[i].path);
    }
}

function ensureExportSubTree(): void {
    const base = getExportImportJsonPath();
    const sig = exportSubSignature(base);
    if (sig === exportSubSig) return;
    exportSubSig = sig;
    rebuildExportSubTree(base);
}

function exportSubTreeRows(): Element[] {
    ensureExportSubTree();
    return pickerTreeRows(exportSubRoots, {
        expansion: exportSubExpansion,
        filter: "",
        selectedPath: canonicalPath(getEffectiveNewExportTarget()),
        disabledLabel: "",
        onSelect: (path) => {
            setNewExportTarget(path);
            markGuiDirty();
        },
        onToggle: (path) => {
            if (exportSubExpansion.has(path)) exportSubExpansion.delete(path);
            else exportSubExpansion.add(path);
            markGuiDirty();
        },
        emptyLabel: "Pick a destination project first",
    });
}

// Create `<folder>/import.json` (included from the deepest existing file whose
// folder contains it, so `functions/combat` nests under functions/) and route
// new exports there. Closes the picker; reopening shows the new file checked.
function newExportFileRow(): Element {
    return newPickerRow("New import.json…", () => {
        const base = getExportImportJsonPath();
        if (base.trim() === "") return;
        openTextPromptPopover({
            title: "New import.json",
            description: [
                "Name a folder to hold the new import.json;",
                "it's created and included in your project.",
                "Use a slash to nest, e.g. functions/combat",
            ],
            placeholder: "combat",
            submitLabel: "Create",
            width: 288,
            onSubmit: (folderPath) => {
                try {
                    const created = createIncludedFolderInTree(base, folderPath);
                    setNewExportTarget(created.importJsonPath);
                    invalidateParseCacheEntry(base);
                    requestParse(base);
                    bumpTreeRevision();
                    closeAllPopovers();
                    showToast(`New exports → ${shortPath(created.importJsonPath)}`, 0xff5cb85c);
                } catch (err) {
                    ChatLib.chat(`&c[htsw] New file failed: ${err}`);
                }
            },
        });
    });
}

// One-shot bulk migration into a folder per type, offered only for a flat
// project. Once split, the folders show up as selectable rows in the tree.
function splitAction(dest: string): Element | false {
    if (dest.trim() === "" || !projectPathExists(dest)) return false;
    if (projectSectionFolders(dest).length > 0) return false;
    return Button({
        icon: Icons.folderTree,
        text: "Split by type…",
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
    const dest = getExportImportJsonPath();

    // Force a fresh sub-tree build on first render (resets expansion for the
    // current destination); `ensureExportSubTree` keeps it current after that.
    exportSubSig = "";

    const projectRows: Element[] = [
        ...open.map(row),
        ...(recents.length === 0 ? [] : [destinationSection("Recent"), ...recents.map(row)]),
    ];

    return Col({
        style: { gap: 4, padding: 4, height: { kind: "grow" } },
        children: [
            destinationSection("Destination project"),
            Scroll({
                id: "export-dest-projects",
                style: { gap: 2, height: { kind: "px", value: EXPORT_PROJECTS_SCROLL_H } },
                children: () => projectRows,
            }),
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
            Row({
                style: { gap: 4, align: "center", height: { kind: "px", value: 16 } },
                children: [
                    Text({
                        text: "New exports land in",
                        color: COLOR_TEXT_FAINT,
                        style: { width: { kind: "grow" }, padding: { side: "x", value: 4 } },
                    }),
                    splitAction(dest),
                ],
            }),
            Scroll({
                id: "export-subtarget-tree",
                style: { gap: 1, height: { kind: "grow" } },
                children: () => exportSubTreeRows(),
            }),
            newExportFileRow(),
        ],
    });
}
