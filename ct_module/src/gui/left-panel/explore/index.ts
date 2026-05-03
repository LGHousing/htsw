/// <reference types="../../../../CTAutocomplete" />

import { ClickInfo, Element, Rect } from "../../lib/layout";
import { Button, Col, Container, Input, Row, Scroll, Text } from "../../lib/components";
import { closeAllPopovers, togglePopover } from "../../lib/popovers";
import { openMenu, MenuAction } from "../../lib/menu";
import {
    ImportEntry,
    Result,
    ResultImport,
    TYPE_COLORS,
    ACTIVE_BG,
    ACTIVE_HOVER_BG,
    ROW_BG,
    ROW_HOVER_BG,
} from "./types";
import {
    SourceDir,
    SourceFile,
    enumerateForSource,
    getSources,
    isDefaultSource,
    queueSourcePath,
    removeAllStandaloneFiles,
    removeSource,
} from "./source";
import { showNativePicker } from "../../../utils/nativePicker";
import { showInExplorer, openInVSCode } from "../../../utils/osShell";
import { previewSelect, confirmSelect } from "../../state/selection";
import { SORT_FIELDS, isSortDefault, sortResults, sortPopoverContent } from "./sort";
import {
    isTypeActive,
    isFilterDefault,
    filterPopoverContent,
    FILTER_POPOVER_HEIGHT,
} from "./filter";

let searchQuery = "";
const expandedImports: Set<string> = new Set();
// Roots are expanded by default; a key in this set means the root is collapsed.
const collapsedRoots: Set<string> = new Set();

const STANDALONE_KEY = "__standalone__";
const ROOT_DIR_PREFIX = "dir:";

function dirRootKey(s: SourceDir): string {
    return ROOT_DIR_PREFIX + s.fullPath;
}

function filterAndSort(all: Result[]): Result[] {
    const q = searchQuery.toLowerCase();
    const out: Result[] = [];
    for (let i = 0; i < all.length; i++) {
        const r = all[i];
        if (!isTypeActive(r.type)) continue;
        if (q.length > 0 && r.path.toLowerCase().indexOf(q) < 0) continue;
        out.push(r);
    }
    return sortResults(out);
}

function dirOf(p: string): string {
    const i = p.lastIndexOf("/");
    return i < 0 ? "" : p.substring(0, i);
}

function joinPath(dir: string, child: string): string {
    if (dir === "") return child;
    return `${dir}/${child}`;
}

function entryRefPath(e: ImportEntry): string | undefined {
    if (e.type === "FUNCTION" || e.type === "EVENT") return e.actionsPath;
    if (e.type === "ITEM") return e.nbtPath;
    return undefined;
}

function entryLabel(e: ImportEntry): string {
    return e.type === "EVENT" ? e.event : e.name;
}

// --- Menu helpers ---------------------------------------------------------

function fsActions(fullPath: string): MenuAction[] {
    return [
        { label: "Show in explorer", onClick: () => showInExplorer(fullPath) },
        { label: "Open with VSCode", onClick: () => openInVSCode(fullPath) },
    ];
}

// Row-specific extras come BEFORE the standard fsActions so the destructive/contextual
// options sit at the top of the menu and the always-present Show/Open actions are anchored
// at the bottom.
function withFsActions(extras: MenuAction[], fullPath: string): MenuAction[] {
    return extras.concat(fsActions(fullPath));
}

function dirRootActions(s: SourceDir): MenuAction[] {
    const extras: MenuAction[] = [];
    if (!isDefaultSource(s.fullPath)) {
        extras.push({
            label: "Close",
            onClick: () => {
                removeSource(s.fullPath);
                collapsedRoots.delete(dirRootKey(s));
            },
        });
    }
    return withFsActions(extras, s.fullPath);
}

function standaloneRootActions(): MenuAction[] {
    return [
        {
            label: "Close all",
            onClick: () => {
                removeAllStandaloneFiles();
            },
        },
    ];
}

function standaloneFileActions(s: SourceFile): MenuAction[] {
    return withFsActions(
        [{ label: "Close", onClick: () => removeSource(s.fullPath) }],
        s.fullPath
    );
}

function resultActions(r: Result): MenuAction[] {
    return fsActions(r.fullPath);
}

function entryActions(parent: ResultImport, e: ImportEntry): MenuAction[] {
    const refRel = entryRefPath(e);
    const target =
        refRel === undefined ? parent.fullPath : joinPath(dirOf(parent.fullPath), refRel);
    return fsActions(target);
}

// Builds a row click handler that:
//   - opens `actions` as a context menu on right-click,
//   - runs `defaultLeftAction` on left-click if provided, otherwise opens the menu,
//   - ignores the second click of a double-click so handlers don't double-fire.
function rowHandler(
    actions: MenuAction[],
    defaultLeftAction?: () => void
): (rect: Rect, info: ClickInfo) => void {
    return (_rect, info) => {
        if (info.isDoubleClickSecond) return;
        if (info.button === 1) {
            openMenu(info.x, info.y, actions);
            return;
        }
        if (info.button !== 0) return;
        if (defaultLeftAction) defaultLeftAction();
        else openMenu(info.x, info.y, actions);
    };
}

// --- Row builders ---------------------------------------------------------

function rootRow(label: string, key: string, actions: MenuAction[]): Element {
    const collapsed = collapsedRoots.has(key);
    return Container({
        style: {
            direction: "row",
            padding: [
                { side: "left", value: 3 },
                { side: "right", value: 6 },
            ],
            gap: 6,
            align: "center",
            height: { kind: "px", value: 18 },
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(actions, () => {
            if (collapsed) collapsedRoots.delete(key);
            else collapsedRoots.add(key);
        }),
        children: [
            Text({ text: collapsed ? "[+]" : "[-]" }),
            Text({ text: label, style: { width: { kind: "grow" } } }),
        ],
    });
}

function resultRow(r: Result): Element {
    const isImport = r.type === "import";
    return Container({
        style: {
            direction: "row",
            padding: [
                { side: "left", value: 3 },
                { side: "right", value: 6 },
            ],
            gap: 6,
            align: "center",
            height: { kind: "px", value: 18 },
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(resultActions(r), () => {
            if (isImport) {
                if (expandedImports.has(r.fullPath)) expandedImports.delete(r.fullPath);
                else expandedImports.add(r.fullPath);
            }
            previewSelect(r.fullPath);
        }),
        onDoubleClick: () => confirmSelect(r.fullPath),
        children: [
            Container({
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                    background: TYPE_COLORS[r.type],
                },
                children: [],
            }),
            Text({
                text: r.path,
                style: { width: { kind: "grow" } },
            }),
            isImport &&
                Text({
                    text: expandedImports.has(r.fullPath) ? "[-]" : "[+]",
                }),
        ],
    });
}

function entryContent(parent: ResultImport, e: ImportEntry): Element {
    const refRel = entryRefPath(e);
    const childFull =
        refRel === undefined ? undefined : joinPath(dirOf(parent.fullPath), refRel);
    const display = entryLabel(e);
    const clickPath = childFull ?? entryLabel(e);
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "grow" },
            padding: { side: "x", value: 3 },
            gap: 6,
            align: "center",
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(entryActions(parent, e), () => previewSelect(clickPath)),
        onDoubleClick: () => confirmSelect(clickPath),
        children: [Text({ text: display })],
    });
}

function standaloneFileRow(s: SourceFile): Element {
    return Container({
        style: {
            direction: "row",
            padding: [
                { side: "left", value: 3 },
                { side: "right", value: 6 },
            ],
            gap: 6,
            align: "center",
            height: { kind: "px", value: 18 },
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(standaloneFileActions(s), () => previewSelect(s.fullPath)),
        onDoubleClick: () => confirmSelect(s.fullPath),
        children: [Text({ text: s.fullPath, style: { width: { kind: "grow" } } })],
    });
}

// --- Tree row layout ------------------------------------------------------

const LEFT_PAD = 7;
const ARM_LEN = 8;
const LINE_THICK = 3;

// Per-level indent step (one ancestor pass-through or branch column).
const INDENT_STEP = LINE_THICK + ARM_LEN;

const ROW_GAP_H = 2;
const LINE_COLOR = ROW_BG;
const ENTRY_ROW_H = 16;

type LevelGuide = "vertical" | "empty";
type BranchKind = "tee" | "ell";
type TreeRow = {
    levels: LevelGuide[];
    branch: BranchKind | null;
    content: Element;
    height: number;
};

function pixel(w: number, h: number): Element {
    return Container({
        style: {
            width: { kind: "px", value: w },
            height: { kind: "px", value: h },
            background: LINE_COLOR,
        },
        children: [],
    });
}

function spacer(w: number, h: number): Element {
    return Container({
        style: {
            width: { kind: "px", value: w },
            height: { kind: "px", value: h },
        },
        children: [],
    });
}

function verticalStripCol(h: number): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "px", value: INDENT_STEP },
            height: { kind: "px", value: h },
        },
        children: [pixel(LINE_THICK, h)],
    });
}

function emptyStripCol(h: number): Element {
    return spacer(INDENT_STEP, h);
}

function branchCol(rowH: number, kind: BranchKind): Element {
    const armTopY = Math.floor((rowH - LINE_THICK) / 2);
    const segs: Element[] = [];
    if (armTopY > 0) segs.push(verticalStripCol(armTopY));
    segs.push(pixel(INDENT_STEP, LINE_THICK));
    const bottomH = rowH - armTopY - LINE_THICK;
    if (bottomH > 0) {
        segs.push(
            kind === "tee" ? verticalStripCol(bottomH) : spacer(INDENT_STEP, bottomH)
        );
    }
    return Container({
        style: {
            direction: "col",
            width: { kind: "px", value: INDENT_STEP },
            height: { kind: "px", value: rowH },
        },
        children: segs,
    });
}

function gapBandFor(r: TreeRow): Element {
    const cols: Element[] = [];
    if (r.levels.length > 0 || r.branch !== null) {
        cols.push(spacer(LEFT_PAD, ROW_GAP_H));
    }
    for (let i = 0; i < r.levels.length; i++) {
        cols.push(
            r.levels[i] === "vertical"
                ? verticalStripCol(ROW_GAP_H)
                : emptyStripCol(ROW_GAP_H)
        );
    }
    if (r.branch !== null) {
        cols.push(verticalStripCol(ROW_GAP_H));
    }
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "px", value: ROW_GAP_H },
        },
        children: cols,
    });
}

function composeTreeRow(r: TreeRow): Element {
    let body: Element;
    if (r.levels.length === 0 && r.branch === null) {
        body = r.content;
    } else {
        const cols: Element[] = [];
        cols.push(spacer(LEFT_PAD, r.height));
        for (let i = 0; i < r.levels.length; i++) {
            cols.push(
                r.levels[i] === "vertical"
                    ? verticalStripCol(r.height)
                    : emptyStripCol(r.height)
            );
        }
        if (r.branch !== null) cols.push(branchCol(r.height, r.branch));
        cols.push(
            Container({
                style: {
                    direction: "col",
                    width: { kind: "grow" },
                    height: { kind: "px", value: r.height },
                },
                children: [r.content],
            })
        );
        body = Container({
            style: {
                direction: "row",
                width: { kind: "grow" },
                height: { kind: "px", value: r.height },
            },
            children: cols,
        });
    }
    return Col({
        style: { width: { kind: "grow" } },
        children: [gapBandFor(r), body],
    });
}

// --- Tree builder ---------------------------------------------------------

type Root =
    | { kind: "dir"; source: SourceDir; key: string }
    | { kind: "standalone"; files: SourceFile[]; key: string };

function buildRoots(): Root[] {
    const sources = getSources();
    const dirs: SourceDir[] = [];
    const files: SourceFile[] = [];
    for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        if (s.kind === "dir") dirs.push(s);
        else files.push(s);
    }
    const out: Root[] = [];
    for (let i = 0; i < dirs.length; i++) {
        out.push({ kind: "dir", source: dirs[i], key: dirRootKey(dirs[i]) });
    }
    if (files.length > 0) {
        out.push({ kind: "standalone", files, key: STANDALONE_KEY });
    }
    return out;
}

function buildTreeRows(): TreeRow[] {
    const roots = buildRoots();
    // Single-root mode: skip the root header and tree branches entirely — render the root's
    // children flat. Matches the pre-refactor behavior when there's only one source.
    const showRootHeaders = roots.length > 1;
    const out: TreeRow[] = [];

    for (let ri = 0; ri < roots.length; ri++) {
        const root = roots[ri];

        if (root.kind === "dir") {
            if (showRootHeaders) {
                out.push({
                    levels: [],
                    branch: null,
                    content: rootRow(
                        root.source.fullPath,
                        root.key,
                        dirRootActions(root.source)
                    ),
                    height: 18,
                });
                if (collapsedRoots.has(root.key)) continue;
            }

            const results = filterAndSort(enumerateForSource(root.source));
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const isLastResult = i === results.length - 1;
                out.push({
                    levels: [],
                    branch: showRootHeaders ? (isLastResult ? "ell" : "tee") : null,
                    content: resultRow(r),
                    height: 18,
                });

                if (r.type === "import" && expandedImports.has(r.fullPath)) {
                    const entries = r.entries;
                    for (let j = 0; j < entries.length; j++) {
                        const isLastEntry = j === entries.length - 1;
                        const entryLevels: LevelGuide[] = showRootHeaders
                            ? [isLastResult ? "empty" : "vertical"]
                            : [];
                        out.push({
                            levels: entryLevels,
                            branch: isLastEntry ? "ell" : "tee",
                            content: entryContent(r, entries[j]),
                            height: ENTRY_ROW_H,
                        });
                    }
                }
            }
        } else {
            if (showRootHeaders) {
                out.push({
                    levels: [],
                    branch: null,
                    content: rootRow(
                        "Standalone files",
                        root.key,
                        standaloneRootActions()
                    ),
                    height: 18,
                });
                if (collapsedRoots.has(root.key)) continue;
            }

            for (let i = 0; i < root.files.length; i++) {
                const isLast = i === root.files.length - 1;
                out.push({
                    levels: [],
                    branch: showRootHeaders ? (isLast ? "ell" : "tee") : null,
                    content: standaloneFileRow(root.files[i]),
                    height: 18,
                });
            }
        }
    }
    return out;
}

function renderRows(): Element[] {
    return buildTreeRows().map(composeTreeRow);
}

function pickerLog(msg: string): void {
    try {
        ChatLib.chat(`&7[picker]&r ${msg}`);
    } catch (_e) {
        /* ignore */
    }
}

function pickSources(mode: "file" | "folder"): void {
    showNativePicker({
        mode,
        onPicked: (paths) => {
            for (let i = 0; i < paths.length; i++) queueSourcePath(paths[i]);
        },
        onError: (msg) => pickerLog(msg),
    });
}

const OPEN_POPOVER_HEIGHT = 6 + 2 * 18 + 1 * 4;

function openMenuContent(): Element {
    return Col({
        style: { padding: 4, gap: 4 },
        children: [
            Button({
                text: "File",
                style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                onClick: () => {
                    closeAllPopovers();
                    pickSources("file");
                },
            }),
            Button({
                text: "Folder",
                style: { width: { kind: "grow" }, height: { kind: "px", value: 18 } },
                onClick: () => {
                    closeAllPopovers();
                    pickSources("folder");
                },
            }),
        ],
    });
}

export function ExploreView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" } },
        children: [
            Row({
                style: { gap: 6, height: { kind: "px", value: 22 }, align: "stretch" },
                children: [
                    Button({
                        text: "Open",
                        style: {
                            width: { kind: "px", value: 40 },
                            height: { kind: "grow" },
                        },
                        onClick: (rect) => {
                            togglePopover({
                                key: "left-open",
                                anchor: rect,
                                content: openMenuContent(),
                                width: 100,
                                height: OPEN_POPOVER_HEIGHT,
                            });
                        },
                    }),
                    Input({
                        id: "left-search",
                        value: () => searchQuery,
                        onChange: (v) => {
                            searchQuery = v;
                        },
                        placeholder: "Search...",
                        style: { width: { kind: "grow" }, height: { kind: "grow" } },
                    }),
                    Button({
                        text: "Sort",
                        style: {
                            width: { kind: "px", value: 40 },
                            height: { kind: "grow" },
                            background: () => (isSortDefault() ? undefined : ACTIVE_BG),
                            hoverBackground: () =>
                                isSortDefault() ? undefined : ACTIVE_HOVER_BG,
                        },
                        onClick: (rect) => {
                            togglePopover({
                                key: "left-sort",
                                anchor: rect,
                                content: sortPopoverContent(),
                                width: 140,
                                height: SORT_FIELDS.length * 20 + 6,
                            });
                        },
                    }),
                    Button({
                        text: "Filter",
                        style: {
                            width: { kind: "px", value: 40 },
                            height: { kind: "grow" },
                            background: () => (isFilterDefault() ? undefined : ACTIVE_BG),
                            hoverBackground: () =>
                                isFilterDefault() ? undefined : ACTIVE_HOVER_BG,
                        },
                        onClick: (rect) => {
                            togglePopover({
                                key: "left-filter",
                                anchor: rect,
                                content: filterPopoverContent(),
                                width: 140,
                                height: FILTER_POPOVER_HEIGHT,
                            });
                        },
                    }),
                ],
            }),
            Scroll({
                id: "left-results-scroll",
                style: { gap: 0, height: { kind: "grow" } },
                children: () => renderRows(),
            }),
        ],
    });
}

