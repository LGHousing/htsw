/// <reference types="../../../../CTAutocomplete" />

import { ClickInfo, Element, Rect } from "../../lib/layout";
import { Button, Col, Container, Icon, Input, Row, Scroll, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import { closeAllPopovers, togglePopover } from "../../lib/popovers";
import { openMenu, MenuAction } from "../../lib/menu";
import { openFileBrowser } from "../../popovers/file-browser";
import { openRenameImportablePopover } from "../../popovers/rename-importable";
import {
    getImportJsonPath,
    isImportableChecked,
    setImportJsonPath,
    toggleImportableChecked,
} from "../../state";
import { scheduleReparse } from "../../state/reparse";
import { addRecent, getRecents } from "../../state/recents";
import { normalizeHtswPath } from "../../lib/pathDisplay";
import {
    Result,
    ResultImport,
    TYPE_COLORS,
    IMPORTABLE_TYPE_COLORS,
    ACTIVE_BG,
    ACTIVE_HOVER_BG,
    ROW_BG,
    ROW_HOVER_BG,
} from "./types";
import type { Importable } from "htsw/types";
import { ACCENT_SUCCESS, COLOR_TEXT_DIM, GLYPH_DOT } from "../../lib/theme";
import { STATUS_COLOR, STATUS_LABEL, statusForImportable } from "../../knowledge-status";
import {
    allReferencedPaths,
    hasSubList,
    importableSourcePath,
    importableSubListPath,
    type SubListKind,
} from "../../state/importablePaths";
import { importableIdentity } from "../../../knowledge/paths";
import { trustPlanKey } from "../../../knowledge/trust";
import { makeImportableQueueItem } from "../../state/queue";
import { composeFileMenu, composeImportableMenu } from "../../state/fileMenu";
import {
    SourceDir,
    SourceFile,
    enumerateForSource,
    getSources,
    queueSourcePath,
    removeAllStandaloneFiles,
    removeSource,
} from "./source";
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
// Keyed by `<sourceKey>::<fullPath>` so the same file surfaced under
// two different sources (a dir root + a standalone, two dir roots that
// both contain it, etc.) keeps independent expansion state. Stores
// explicit user toggles; absent keys fall back to `defaultExpanded` —
// currently true only for the sole import in a single-import session,
// so the only file you just opened doesn't hide its importables behind
// an extra click.
const importExpansion: Map<string, boolean> = new Map();
function expansionKey(sourceKey: string, fullPath: string): string {
    return `${sourceKey}::${fullPath}`;
}
function isImportExpanded(expKey: string, defaultExpanded: boolean): boolean {
    const explicit = importExpansion.get(expKey);
    if (explicit !== undefined) return explicit;
    return defaultExpanded;
}
// Roots are expanded by default; a key in this set means the root is collapsed.
const collapsedRoots: Set<string> = new Set();

// Per-importable sub-row expansion (REGION → Enter/Exit actions; ITEM →
// Left/Right click actions). Keyed by `<parent.fullPath>::<type>:<identity>`
// so the same importable in two different parses keeps independent state.
const importableExpansion: Set<string> = new Set();
function importableExpansionKey(parentFullPath: string, imp: Importable): string {
    return `${parentFullPath}::${imp.type}:${importableIdentity(imp)}`;
}

const SUB_LIST_LABELS: { [k in SubListKind]: string } = {
    onEnterActions: "Enter actions",
    onExitActions: "Exit actions",
    leftClickActions: "Left click actions",
    rightClickActions: "Right click actions",
};

function subListsOf(imp: Importable): SubListKind[] {
    if (imp.type === "REGION") {
        const out: SubListKind[] = [];
        if (hasSubList(imp, "onEnterActions")) out.push("onEnterActions");
        if (hasSubList(imp, "onExitActions")) out.push("onExitActions");
        return out;
    }
    if (imp.type === "ITEM") {
        const out: SubListKind[] = [];
        if (hasSubList(imp, "leftClickActions")) out.push("leftClickActions");
        if (hasSubList(imp, "rightClickActions")) out.push("rightClickActions");
        return out;
    }
    return [];
}

function isImportableExpandable(imp: Importable): boolean {
    return subListsOf(imp).length > 0;
}

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

const MAX_TAIL_SEGMENTS = 3;

// Compact any path shown in the Explore page to a uniform shape:
//   `.../<dir1>/<dir2>/<dir3>` (last MAX_TAIL_SEGMENTS segments).
// The leading `...` is always present so every path on the page reads
// the same way, regardless of how deep it actually is on disk. Paths
// with fewer than MAX_TAIL_SEGMENTS segments still get the prefix —
// `.../foo.htsl` — for consistency.
function formatFullDir(fullPath: string): string {
    if (!fullPath) return fullPath;
    const norm = fullPath.replace(/\\/g, "/");
    const parts = norm.split("/").filter((s) => s.length > 0);
    const tail =
        parts.length <= MAX_TAIL_SEGMENTS
            ? parts.join("/")
            : parts.slice(parts.length - MAX_TAIL_SEGMENTS).join("/");
    return `.../${tail}`;
}

function importableLabel(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}

/**
 * Resolve the file an importable should preview-into when its row is
 * left-clicked. Falls back to the parent import.json if the importable
 * has no resolvable source (REGION/MENU/NPC live entirely as inline
 * JSON; they have no separate htsl/snbt to jump to).
 */
function importablePreviewPath(parent: ResultImport, imp: Importable): string {
    const src = importableSourcePath(imp, parent.parse);
    if (src !== undefined) return src;
    return parent.fullPath;
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
    const extras: MenuAction[] = [
        {
            label: "Close",
            onClick: () => {
                removeSource(s.fullPath);
                collapsedRoots.delete(dirRootKey(s));
            },
        },
    ];
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

/**
 * Right-click menu for an importable row. Routes through
 * `composeImportableMenu` (not `composeFileMenu`) so the queue toggle
 * uses the precise importable identity instead of guessing from the
 * file path — correct even when an htsl is referenced by several
 * importables, or when REGION/MENU/NPC have no separate source file at
 * all and the path resolves back to the parent import.json.
 */
function importableActions(parent: ResultImport, imp: Importable): MenuAction[] {
    const target = importablePreviewPath(parent, imp);
    const item = makeImportableQueueItem(imp, parent.fullPath);
    // Rename is per-importable; not all types support it (EVENTs are
    // identified by their event constant, so renaming doesn't apply —
    // the popover handles the EVENT branch with a chat note).
    const extras: MenuAction[] = [
        {
            label: "Rename",
            onClick: () => {
                openRenameImportablePopover(
                    { x: 0, y: 0, w: 0, h: 0 },
                    parent.fullPath,
                    imp
                );
            },
        },
    ];
    return composeImportableMenu(extras, target, item);
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
            Icon({ name: collapsed ? Icons.chevronRight : Icons.chevronDown }),
            Text({ text: label, style: { width: { kind: "grow" } } }),
        ],
    });
}

// `extraActions` are prepended to the standard `resultActions` so callers
// can layer row-specific options (e.g. "Close" for a standalone file row)
// without forking the whole row builder. `labelOverride` lets standalone
// rows show their full-path tail instead of the bare filename that
// `enumerateForSource` produces for single-file sources.
function resultRow(
    r: Result,
    sourceKey: string,
    defaultExpanded: boolean,
    extraActions: MenuAction[] = [],
    labelOverride?: string
): Element {
    const isImport = r.type === "import";
    const expKey = expansionKey(sourceKey, r.fullPath);
    const expanded = isImport && isImportExpanded(expKey, defaultExpanded);
    // Import.json rows get an extra "Open in VSCode (with references)"
    // action at the top of `extras` so it sits with other contextual
    // entries above the always-present generics.
    const fileExtras: MenuAction[] = isImport && r.type === "import"
        ? [
              {
                  label: "Open in VSCode (with references)",
                  onClick: () => {
                      const paths = allReferencedPaths(r.fullPath, r.parse);
                      openInVSCode(paths);
                  },
              },
              ...extraActions,
          ]
        : extraActions;
    // Always route through composeFileMenu so the menu shape matches the
    // right panel's tab menu: side-specific extras pinned at the top, a
    // separator, then the universal generics (Add to queue / Show in
    // explorer / Open with VSCode) at the bottom.
    const actions = composeFileMenu(fileExtras, r.fullPath);
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
            if (isImport) {
                importExpansion.set(expKey, !expanded);
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
                // Folder-rooted rows show the path relative to their
                // source dir (`r.path` from `enumerateForSource`) so a
                // file at the root reads as `foo.htsl` and a nested one
                // as `sub/foo.htsl`. Standalone rows pass an explicit
                // `labelOverride` (the `.../<dir1>/<dir2>/<dir3>` shape
                // from `formatFullDir`) since they have no enclosing
                // source dir to be relative to.
                text: labelOverride ?? r.path,
                style: { width: { kind: "grow" } },
            }),
            isImport &&
                Icon({
                    name: expanded ? Icons.chevronDown : Icons.chevronRight,
                }),
        ],
    });
}

/**
 * Sub-row rendered under an expanded import.json. Looks like the old
 * Importables-tab row: type-color swatch, the importable's display name,
 * its type label on the right. Right-click goes through
 * `composeImportableMenu` so "Add to queue" knows which importable it
 * targets without scanning by file path.
 */
function importableRow(parent: ResultImport, imp: Importable): Element {
    const previewPath = importablePreviewPath(parent, imp);
    const status = statusForImportable(imp);
    const expandable = isImportableExpandable(imp);
    const expKey = importableExpansionKey(parent.fullPath, imp);
    const expanded = importableExpansion.has(expKey);
    const checkKey = trustPlanKey(imp.type, importableIdentity(imp));
    const checked = isImportableChecked(checkKey);
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
        // Single click on the row body toggles the multi-select checkbox.
        // Double click opens the file in a tab. Expansion (REGION/ITEM
        // sub-lists) lives on the chevron container so the row itself is
        // unambiguously a "select" surface.
        onClick: rowHandler(importableActions(parent, imp), () => {
            toggleImportableChecked(checkKey);
        }),
        onDoubleClick: () => confirmSelect(previewPath),
        children: [
            // Checkbox visual — direct child of the row so the row's
            // align: "center" handles vertical centering naturally.
            // Wrapping in a sub-container made the text pin to the top.
            Text({
                text: checked ? "[x]" : "[ ]",
                color: checked ? ACCENT_SUCCESS : COLOR_TEXT_DIM,
                style: { width: { kind: "px", value: 14 } },
            }),
            Container({
                style: {
                    width: { kind: "px", value: 6 },
                    height: { kind: "px", value: 12 },
                    background: IMPORTABLE_TYPE_COLORS[imp.type],
                },
                children: [],
            }),
            Text({
                text: GLYPH_DOT,
                color: STATUS_COLOR[status],
                tooltip: STATUS_LABEL[status],
                tooltipColor: STATUS_COLOR[status],
                style: { width: { kind: "px", value: 6 } },
            }),
            Text({
                text: importableLabel(imp),
                style: { width: { kind: "grow" } },
            }),
            Text({ text: imp.type, color: 0xff8a92a3 | 0 }),
            expandable &&
                Container({
                    style: {
                        width: { kind: "px", value: 14 },
                        height: { kind: "grow" },
                        align: "center",
                    },
                    onClick: (_rect, info) => {
                        if (info.isDoubleClickSecond) return;
                        if (info.button !== 0) return;
                        if (expanded) importableExpansion.delete(expKey);
                        else importableExpansion.add(expKey);
                    },
                    children: [
                        Icon({
                            name: expanded ? Icons.chevronDown : Icons.chevronRight,
                        }),
                    ],
                }),
        ],
    });
}

/**
 * Sub-row rendered under an expanded REGION/ITEM importable. Shows the
 * label of the action sub-list (Enter/Exit/Left-click/Right-click) and
 * previews/pins its source file when clicked. Right-click goes through
 * `composeFileMenu` on the resolved sub-list path so "Add to queue" /
 * "Show in explorer" / etc. work the same as on regular rows.
 */
function subRow(parent: ResultImport, imp: Importable, kind: SubListKind): Element {
    const label = SUB_LIST_LABELS[kind];
    const path = importableSubListPath(imp, kind);
    const target = path ?? parent.fullPath;
    const actions = composeFileMenu([], target);
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
        onClick: rowHandler(actions, () => previewSelect(target)),
        onDoubleClick: () => confirmSelect(target),
        children: [
            Text({
                text: label,
                color: 0xff8a92a3 | 0,
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

// Build the per-row "Close" menu entry for a standalone file. Layered on
// top of the normal result menu by passing as `extraActions` to
// `resultRow`, so the rest of the menu (Show in explorer / Open with
// VSCode / etc.) matches what folder-rooted rows show.
function standaloneCloseAction(s: SourceFile): MenuAction[] {
    return [{ label: "Close", onClick: () => removeSource(s.fullPath) }];
}

// --- Tree row layout ------------------------------------------------------

const LEFT_PAD = 7;
const ARM_LEN = 8;
const LINE_THICK = 3;

// The actual line+arm portion drawn inside each indent column.
const TREE_LINE_W = LINE_THICK + ARM_LEN;
// Per-level indent step. Each indent column starts with a LEFT_PAD-wide transparent gutter,
// followed by the line+arm (TREE_LINE_W). Two consecutive levels therefore appear separated by
// LEFT_PAD of empty space, mirroring the panel's outer gutter at every nesting depth.
const INDENT_STEP = LEFT_PAD + TREE_LINE_W;

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

// Each indent column has an internal LEFT_PAD-wide gutter on its left, then the line/arm.
// The vertical line therefore lands at x=LEFT_PAD..LEFT_PAD+LINE_THICK within the column.
function verticalStripCol(h: number): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "px", value: INDENT_STEP },
            height: { kind: "px", value: h },
        },
        children: [spacer(LEFT_PAD, h), pixel(LINE_THICK, h)],
    });
}

function emptyStripCol(h: number): Element {
    return spacer(INDENT_STEP, h);
}

function horizontalArm(): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "px", value: INDENT_STEP },
            height: { kind: "px", value: LINE_THICK },
        },
        children: [spacer(LEFT_PAD, LINE_THICK), pixel(TREE_LINE_W, LINE_THICK)],
    });
}

function branchCol(rowH: number, kind: BranchKind): Element {
    const armTopY = Math.floor((rowH - LINE_THICK) / 2);
    const segs: Element[] = [];
    if (armTopY > 0) segs.push(verticalStripCol(armTopY));
    segs.push(horizontalArm());
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

// LEFT_PAD is applied uniformly to every row (including ones with no levels/branch) so each
// extra level of nesting adds exactly INDENT_STEP. Without this, top-level rows started flush
// at x=0 while their first descendant jumped by LEFT_PAD + INDENT_STEP, making the second
// descendant's INDENT_STEP-only jump look like the indent was being "applied only once".
function gapBandFor(r: TreeRow): Element {
    const cols: Element[] = [spacer(LEFT_PAD, ROW_GAP_H)];
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
    const cols: Element[] = [spacer(LEFT_PAD, r.height)];
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
    const body = Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "px", value: r.height },
        },
        children: cols,
    });
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
    let dirCount = 0;
    let standaloneCount = 0;
    for (let i = 0; i < roots.length; i++) {
        const r = roots[i];
        if (r.kind === "dir") dirCount++;
        else standaloneCount = r.files.length;
    }
    // Per-root header visibility:
    //   - dir roots: always show the header so the user can collapse / get
    //     context, even when only one folder is open.
    //   - standalone group: show the header in every case except the lone
    //     "single source" mode (no dirs + exactly one standalone file),
    //     where a header would just add noise above one row.
    const showHeaderFor = (root: Root): boolean => {
        if (root.kind === "dir") return true;
        return !(dirCount === 0 && standaloneCount === 1);
    };
    // Count imports across every opened source (unfiltered — search/type
    // filtering shouldn't change the default). When there's exactly one,
    // its row defaults to expanded.
    let totalImports = 0;
    let soleImportKey = "";
    for (let ri = 0; ri < roots.length; ri++) {
        const root = roots[ri];
        if (root.kind === "dir") {
            const allResults = enumerateForSource(root.source);
            for (let i = 0; i < allResults.length; i++) {
                if (allResults[i].type === "import") {
                    totalImports++;
                    soleImportKey = expansionKey(root.key, allResults[i].fullPath);
                }
            }
        } else {
            for (let fi = 0; fi < root.files.length; fi++) {
                const file = root.files[fi];
                const allResults = enumerateForSource(file);
                for (let i = 0; i < allResults.length; i++) {
                    if (allResults[i].type === "import") {
                        totalImports++;
                        soleImportKey = expansionKey(
                            `file:${file.fullPath}`,
                            allResults[i].fullPath
                        );
                    }
                }
            }
        }
    }
    if (totalImports !== 1) soleImportKey = "";
    const out: TreeRow[] = [];

    for (let ri = 0; ri < roots.length; ri++) {
        const root = roots[ri];
        const headered = showHeaderFor(root);

        if (root.kind === "dir") {
            if (headered) {
                out.push({
                    levels: [],
                    branch: null,
                    content: rootRow(
                        formatFullDir(root.source.fullPath),
                        root.key,
                        dirRootActions(root.source)
                    ),
                    height: 18,
                });
                if (collapsedRoots.has(root.key)) continue;
            }

            const dirSourceKey = root.key;
            const results = filterAndSort(enumerateForSource(root.source));
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const isLastResult = i === results.length - 1;
                const expKey = expansionKey(dirSourceKey, r.fullPath);
                const defaultExpanded = expKey === soleImportKey;
                out.push({
                    levels: [],
                    branch: headered ? (isLastResult ? "ell" : "tee") : null,
                    content: resultRow(r, dirSourceKey, defaultExpanded),
                    height: 18,
                });

                if (r.type === "import" && isImportExpanded(expKey, defaultExpanded)) {
                    const importables = r.importables;
                    for (let j = 0; j < importables.length; j++) {
                        const imp = importables[j];
                        const isLastImp = j === importables.length - 1;
                        const impLevels: LevelGuide[] = headered
                            ? [isLastResult ? "empty" : "vertical"]
                            : [];
                        out.push({
                            levels: impLevels,
                            branch: isLastImp ? "ell" : "tee",
                            content: importableRow(r, imp),
                            height: ENTRY_ROW_H,
                        });
                        const subKey = importableExpansionKey(r.fullPath, imp);
                        if (importableExpansion.has(subKey)) {
                            const subs = subListsOf(imp);
                            for (let k = 0; k < subs.length; k++) {
                                const isLastSub = k === subs.length - 1;
                                const subLevels: LevelGuide[] = impLevels.concat([
                                    isLastImp ? "empty" : "vertical",
                                ]);
                                out.push({
                                    levels: subLevels,
                                    branch: isLastSub ? "ell" : "tee",
                                    content: subRow(r, imp, subs[k]),
                                    height: ENTRY_ROW_H,
                                });
                            }
                        }
                    }
                }
            }
        } else {
            if (headered) {
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

            // Run each standalone file through the same enumeration that
            // a folder-rooted source uses. That gives us a real `Result`
            // (typed import.json / htsl / snbt) so the rows render with
            // `resultRow` and inherit its actions, expansion, and entry
            // sub-rows. Per-file `Close` is layered on via `extraActions`.
            for (let i = 0; i < root.files.length; i++) {
                const file = root.files[i];
                // Each standalone file is its own source for expansion-key
                // purposes, so two adds of the same path keep independent
                // [+]/[-] state from each other and from any folder root.
                const fileSourceKey = `file:${file.fullPath}`;
                const isLastFile = i === root.files.length - 1;
                const fileResults = filterAndSort(enumerateForSource(file));
                for (let j = 0; j < fileResults.length; j++) {
                    const r = fileResults[j];
                    const isLastResult = isLastFile && j === fileResults.length - 1;
                    const expKey = expansionKey(fileSourceKey, r.fullPath);
                    const defaultExpanded = expKey === soleImportKey;
                    out.push({
                        levels: [],
                        branch: headered ? (isLastResult ? "ell" : "tee") : null,
                        content: resultRow(
                            r,
                            fileSourceKey,
                            defaultExpanded,
                            standaloneCloseAction(file),
                            // For single-file sources `r.path` collapses to the
                            // bare filename; show the last-3-dirs tail instead
                            // so the user can tell two same-named files apart.
                            formatFullDir(file.fullPath)
                        ),
                        height: 18,
                    });

                    if (r.type === "import" && isImportExpanded(expKey, defaultExpanded)) {
                        const importables = r.importables;
                        for (let k = 0; k < importables.length; k++) {
                            const imp = importables[k];
                            const isLastImp = k === importables.length - 1;
                            const impLevels: LevelGuide[] = headered
                                ? [isLastResult ? "empty" : "vertical"]
                                : [];
                            out.push({
                                levels: impLevels,
                                branch: isLastImp ? "ell" : "tee",
                                content: importableRow(r, imp),
                                height: ENTRY_ROW_H,
                            });
                            const subKey = importableExpansionKey(r.fullPath, imp);
                            if (importableExpansion.has(subKey)) {
                                const subs = subListsOf(imp);
                                for (let s = 0; s < subs.length; s++) {
                                    const isLastSub = s === subs.length - 1;
                                    const subLevels: LevelGuide[] = impLevels.concat([
                                        isLastImp ? "empty" : "vertical",
                                    ]);
                                    out.push({
                                        levels: subLevels,
                                        branch: isLastSub ? "ell" : "tee",
                                        content: subRow(r, imp, subs[s]),
                                        height: ENTRY_ROW_H,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return out;
}

function renderRows(): Element[] {
    return buildTreeRows().map(composeTreeRow);
}

function dirOfPath(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}

function openBrowseModal(): void {
    closeAllPopovers();
    openFileBrowser(dirOfPath(getImportJsonPath()) || ".");
}

function loadRecent(path: string): void {
    queueSourcePath(path);
    setImportJsonPath(path);
    addRecent(path);
    scheduleReparse();
    closeAllPopovers();
}

function recentsPopoverContent(): Element {
    return Scroll({
        id: "left-recents-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () => {
            const rs = getRecents();
            if (rs.length === 0) {
                return [
                    Container({
                        style: { padding: 6 },
                        children: [
                            Text({
                                text: "No recent files",
                                color: 0xff8a92a3 | 0,
                            }),
                        ],
                    }),
                ];
            }
            return rs.map((p) =>
                Container({
                    style: {
                        direction: "row",
                        align: "center",
                        padding: { side: "x", value: 6 },
                        height: { kind: "px", value: 18 },
                        background: ROW_BG,
                        hoverBackground: ROW_HOVER_BG,
                    },
                    onClick: () => loadRecent(p),
                    children: [
                        Text({
                            text: normalizeHtswPath(p),
                            style: { width: { kind: "grow" } },
                        }),
                    ],
                })
            );
        },
    });
}

function emptyStateRow(): Element {
    return Container({
        style: { padding: 8 },
        children: [
            Text({
                text: "Click Browse to open an import.json.",
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

export function ExploreView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" } },
        children: [
            // Single loader entry point — Browse opens the file-browser
            // popover, which handles both file and folder selection (paste
            // a path / pick an import.json / pick a folder). The Recent
            // dropdown surfaces previously-loaded import.jsons.
            Row({
                style: { gap: 6, height: { kind: "px", value: 22 }, align: "stretch" },
                children: [
                    Button({
                        icon: Icons.search,
                        text: "Browse",
                        style: { width: { kind: "grow" }, height: { kind: "grow" } },
                        onClick: () => openBrowseModal(),
                    }),
                    Button({
                        icon: Icons.history,
                        text: "Recent",
                        style: { width: { kind: "px", value: 80 }, height: { kind: "grow" } },
                        onClick: (rect) => {
                            togglePopover({
                                key: "left-recents",
                                anchor: rect,
                                content: recentsPopoverContent(),
                                width: 280,
                                height: Math.min(180, getRecents().length * 20 + 12),
                            });
                        },
                    }),
                ],
            }),
            Row({
                style: { gap: 6, height: { kind: "px", value: 22 }, align: "stretch" },
                children: [
                    // Search prefix: icon + input grouped in a Row so the
                    // glyph reads as part of the field, not a separate cell.
                    Row({
                        style: {
                            gap: 4,
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            align: "center",
                            padding: { side: "left", value: 4 },
                        },
                        children: [
                            Icon({ name: Icons.search }),
                            Input({
                                id: "left-search",
                                value: () => searchQuery,
                                onChange: (v) => {
                                    searchQuery = v;
                                },
                                placeholder: "Search...",
                                style: { width: { kind: "grow" }, height: { kind: "grow" } },
                            }),
                        ],
                    }),
                    Button({
                        icon: Icons.arrowUpDown,
                        style: {
                            width: { kind: "px", value: 26 },
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
                        icon: Icons.filter,
                        style: {
                            width: { kind: "px", value: 26 },
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
                children: () => {
                    const rows = renderRows();
                    if (rows.length === 0) return [emptyStateRow()];
                    return rows;
                },
            }),
        ],
    });
}

