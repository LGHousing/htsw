/// <reference types="../../../../CTAutocomplete" />

import {
    Element,
    getScrollState,
    setScrollOffset,
} from "../../lib/layout";
import { Col, Container, Text } from "../../lib/components";
import { COLOR_TEXT_DIM } from "../../lib/theme";
import {
    Source,
    SourceDir,
    SourceFile,
    enumerateForSource,
    getSources,
} from "./source";
import { sortResults } from "./sort";
import { isImportableTypeActive, isFilterDefault } from "./filter";
import { Result, ResultImport, ROW_BG, bumpTreeRevision, getTreeRevision } from "./rowModel";
import { IncludeNode, includeAncestorPaths, includeTreeOf } from "./includeTree";
import { canonicalPath } from "../../parsing/parses";
import { compactPath } from "../../lib/pathDisplay";
import {
    searchQuery,
    expansionKey,
    isImportExpanded,
    collapsedRoots,
    importableExpansion,
    importableExpansionKey,
    expandIncludeGroup,
    includeGroupKey,
    includeGroupRow,
    isIncludeGroupExpanded,
    setJumpFlash,
    childListsOf,
    metadataFieldsOf,
    dirRootKey,
    dirRootActions,
    rootRow,
    resultRow,
    importableRow,
    childListRow,
    metadataRow,
    menuSlotExpansionKey,
    menuSlotRow,
    menuSlotFileRow,
    standaloneCloseAction,
} from "./rows";
import type { Importable } from "htsw/types";

const LEFT_PAD = 7;
const ARM_LEN = 8;
const LINE_THICK = 3;

const TREE_LINE_W = LINE_THICK + ARM_LEN;
const INDENT_STEP = LEFT_PAD + TREE_LINE_W;

const ROW_GAP_H = 2;
const LINE_COLOR = ROW_BG;
const ENTRY_ROW_H = 16;

type LevelGuide = "vertical" | "empty";
type BranchKind = "tee" | "ell";
type TreeRow = {
    levels: LevelGuide[];
    branch: BranchKind | null;
    content: () => Element;
    height: number;
    /** Set on home include-group rows so a reference-row jump can find them. */
    key?: string;
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
            children: [r.content()],
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

type Root =
    | { kind: "dir"; source: SourceDir; key: string }
    | { kind: "standalone"; files: SourceFile[] };

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
        out.push({ kind: "standalone", files });
    }
    return out;
}

function importableName(imp: { type: string; name?: string; event?: string }): string {
    return imp.type === "EVENT" ? (imp as any).event : (imp as any).name;
}

function filterImportableList(r: ResultImport, list: Importable[]): Importable[] {
    const q = searchQuery.toLowerCase();
    const pathMatch = q.length === 0 || r.path.toLowerCase().indexOf(q) >= 0;
    const out: Importable[] = [];
    for (let j = 0; j < list.length; j++) {
        const imp = list[j];
        if (!isImportableTypeActive(imp.type)) continue;
        if (q.length > 0 && !pathMatch) {
            if (importableName(imp).toLowerCase().indexOf(q) < 0) continue;
        }
        out.push(imp);
    }
    return out;
}

function filterImportables(r: ResultImport): ResultImport["importables"] {
    return filterImportableList(r, r.importables);
}

function isNarrowing(): boolean {
    return !isFilterDefault() || searchQuery.length > 0;
}

function groupHasVisibleContent(r: ResultImport, node: IncludeNode): boolean {
    if (filterImportableList(r, node.importables).length > 0) return true;
    for (let i = 0; i < node.includes.length; i++) {
        if (groupHasVisibleContent(r, node.includes[i])) return true;
    }
    return false;
}

function filterAndSort(all: Result[]): Result[] {
    const hasTypeFilter = !isFilterDefault();
    const q = searchQuery.toLowerCase();
    const out: Result[] = [];
    for (let i = 0; i < all.length; i++) {
        const r = all[i];
        if (hasTypeFilter && r.type !== "import") continue;
        if (r.type === "import") {
            if (filterImportables(r).length === 0) {
                const narrowing = hasTypeFilter || q.length > 0;
                if (narrowing || r.importables.length > 0) continue;
            }
        } else {
            if (q.length > 0 && r.path.toLowerCase().indexOf(q) < 0) continue;
        }
        out.push(r);
    }
    return sortResults(out);
}

// An import.json that another file in the same source includes renders as a
// nested group inside that file's tree — its own top-level row would repeat
// the same content. Mutual includes (a cycle, already an error) keep both
// rows rather than hiding both.
function resultsForSource(s: Source): Result[] {
    const all = enumerateForSource(s);
    const includesByRow: (Set<string> | null)[] = [];
    let anyIncludes = false;
    for (let i = 0; i < all.length; i++) {
        const r = all[i];
        const tree = r.type !== "import" || r.parse === null ? null : r.parse.importJson.fileTree;
        if (tree === null || tree.includes.length === 0) {
            includesByRow.push(null);
            continue;
        }
        const set = new Set<string>();
        const collectDescendants = (node: IncludeNode): void => {
            for (let j = 0; j < node.includes.length; j++) {
                set.add(canonicalPath(node.includes[j].path));
                collectDescendants(node.includes[j]);
            }
        };
        collectDescendants(tree);
        includesByRow.push(set);
        anyIncludes = true;
    }
    if (!anyIncludes) return all;
    const out: Result[] = [];
    for (let i = 0; i < all.length; i++) {
        const r = all[i];
        if (r.type === "import" && isIncludedElsewhere(all, includesByRow, i)) continue;
        out.push(r);
    }
    return out;
}

function isIncludedElsewhere(
    all: Result[],
    includesByRow: (Set<string> | null)[],
    i: number
): boolean {
    const myPath = canonicalPath(all[i].fullPath);
    const mine = includesByRow[i];
    for (let j = 0; j < all.length; j++) {
        if (j === i) continue;
        const theirs = includesByRow[j];
        if (theirs === null || !theirs.has(myPath)) continue;
        if (mine !== null && mine.has(canonicalPath(all[j].fullPath))) continue;
        return true;
    }
    return false;
}

// Emit an expanded import.json's contents: each included file as a
// (collapsible) group whose contents recurse, then the file's own
// importables — groups first, like folders before files, so includes don't
// hide below a long flat run. While a search/type filter narrows, groups
// auto-expand and empty ones disappear.
function emitImportContents(out: TreeRow[], r: ResultImport, baseLevels: LevelGuide[]): void {
    if (r.parsePending && r.parse === null) {
        out.push({
            levels: baseLevels,
            branch: "ell",
            content: () => pendingImportablesRow(),
            height: ENTRY_ROW_H,
        });
        return;
    }
    emitIncludeNode(out, r, includeTreeOf(r), baseLevels, isNarrowing());
}

function pendingImportablesRow(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "left", value: 3 },
            height: { kind: "px", value: ENTRY_ROW_H },
        },
        children: [
            Text({
                text: "Loading importables...",
                color: COLOR_TEXT_DIM,
            }),
        ],
    });
}

function emitIncludeNode(
    out: TreeRow[],
    r: ResultImport,
    node: IncludeNode,
    levels: LevelGuide[],
    narrowing: boolean
): void {
    const imps = filterImportableList(r, node.importables);
    // Missing includes aren't rendered in-game (the manifest's own error
    // badge already flags them); VS Code's tree does show them.
    const present = node.includes.filter((c) => c.missing !== true);
    const kids = narrowing
        ? present.filter((c) => groupHasVisibleContent(r, c))
        : present;
    const total = imps.length + kids.length;
    let idx = 0;
    for (let j = 0; j < kids.length; j++) {
        idx++;
        const kid = kids[j];
        const isLast = idx === total;
        const kidPath = canonicalPath(kid.path);
        const expKey = includeGroupKey(r.fullPath, kidPath);
        const isReference = kid.reference === true;
        out.push({
            levels,
            branch: isLast ? "ell" : "tee",
            content: () => includeGroupRow(
                r,
                kid,
                expKey,
                narrowing,
                canonicalPath(node.path),
                isReference ? () => jumpToIncludeNode(r, kidPath) : undefined
            ),
            height: 18,
            key: isReference ? undefined : expKey,
        });
        if (!isReference && isIncludeGroupExpanded(expKey, narrowing)) {
            emitIncludeNode(
                out,
                r,
                kid,
                levels.concat([isLast ? "empty" : "vertical"]),
                narrowing
            );
        }
    }
    for (let j = 0; j < imps.length; j++) {
        idx++;
        const imp = imps[j];
        const isLast = idx === total;
        out.push({
            levels,
            branch: isLast ? "ell" : "tee",
            content: () => importableRow(r, imp),
            height: ENTRY_ROW_H,
        });
        const subKey = importableExpansionKey(r.fullPath, imp);
        if (importableExpansion.has(subKey)) {
            const subs = childListsOf(imp);
            const slots = imp.type === "MENU" ? imp.slots : [];
            const metaCount = metadataFieldsOf(imp).length;
            const totalChildren = subs.length + slots.length + metaCount;
            let childIdx = 0;
            const childLevels: LevelGuide[] = levels.concat([
                isLast ? "empty" : "vertical",
            ]);
            for (let k = 0; k < subs.length; k++) {
                childIdx++;
                out.push({
                    levels: childLevels,
                    branch: childIdx === totalChildren ? "ell" : "tee",
                    content: () => childListRow(r, imp, subs[k]),
                    height: ENTRY_ROW_H,
                });
            }
            for (let k = 0; k < slots.length; k++) {
                childIdx++;
                const slot = slots[k];
                const slotIsLast = childIdx === totalChildren;
                out.push({
                    levels: childLevels,
                    branch: slotIsLast ? "ell" : "tee",
                    content: () => menuSlotRow(r, imp, slot),
                    height: ENTRY_ROW_H,
                });
                if (importableExpansion.has(menuSlotExpansionKey(r, imp, slot))) {
                    const grandLevels: LevelGuide[] = childLevels.concat([
                        slotIsLast ? "empty" : "vertical",
                    ]);
                    const hasActions = slot.actions !== undefined;
                    out.push({
                        levels: grandLevels,
                        branch: hasActions ? "tee" : "ell",
                        content: () => menuSlotFileRow(r, imp, slot, "item"),
                        height: ENTRY_ROW_H,
                    });
                    if (hasActions) {
                        out.push({
                            levels: grandLevels,
                            branch: "ell",
                            content: () => menuSlotFileRow(r, imp, slot, "actions"),
                            height: ENTRY_ROW_H,
                        });
                    }
                }
            }
            for (let k = 0; k < metaCount; k++) {
                childIdx++;
                out.push({
                    levels: childLevels,
                    branch: childIdx === totalChildren ? "ell" : "tee",
                    content: () => metadataRow(r, imp, metadataFieldsOf(imp)[k]),
                    height: ENTRY_ROW_H,
                });
            }
        }
    }
}

function formatFullDir(fullPath: string): string {
    if (!fullPath) return fullPath;
    return compactPath(fullPath);
}

// Descriptor cache: building TreeRows walks every file and importable and
// allocates a descriptor + content closure per row — for a big tree that
// per-frame walk is real main-thread cost under Rhino, even though offscreen
// content() never runs. Descriptors only encode STRUCTURE (per-frame state
// like dots/checkboxes lives inside content(), which still runs per visible
// row per frame), so reuse is safe. Interactions bump the revision for an
// instant rebuild; the TTL picks up async changes (reparse, enumeration).
let cachedTreeRows: TreeRow[] | null = null;
let cachedTreeRevision = -1;
let cachedTreeAt = 0;
const TREE_ROWS_TTL_MS = 300;

let lastBuildMs = 0;
let maxBuildMs = 0;
let buildCount = 0;

export function getTreePerfStats(): { lastBuildMs: number; maxBuildMs: number; builds: number; rows: number } {
    return {
        lastBuildMs,
        maxBuildMs,
        builds: buildCount,
        rows: cachedTreeRows === null ? 0 : cachedTreeRows.length,
    };
}

function treeRows(): TreeRow[] {
    const now = Date.now();
    if (
        cachedTreeRows !== null &&
        cachedTreeRevision === getTreeRevision() &&
        now - cachedTreeAt < TREE_ROWS_TTL_MS
    ) {
        return cachedTreeRows;
    }
    cachedTreeRows = buildTreeRows();
    cachedTreeRevision = getTreeRevision();
    cachedTreeAt = now;
    lastBuildMs = Date.now() - now;
    if (lastBuildMs > maxBuildMs) maxBuildMs = lastBuildMs;
    buildCount++;
    return cachedTreeRows;
}

function buildTreeRows(): TreeRow[] {
    const roots = buildRoots();
    let totalImports = 0;
    let soleImportKey = "";
    for (let ri = 0; ri < roots.length; ri++) {
        const root = roots[ri];
        if (root.kind === "dir") {
            const allResults = resultsForSource(root.source);
            for (let i = 0; i < allResults.length; i++) {
                if (allResults[i].type === "import") {
                    totalImports++;
                    soleImportKey = expansionKey(root.key, allResults[i].fullPath);
                }
            }
        } else {
            for (let fi = 0; fi < root.files.length; fi++) {
                const file = root.files[fi];
                const allResults = resultsForSource(file);
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

        if (root.kind === "dir") {
            out.push({
                levels: [],
                branch: null,
                content: () => rootRow(
                    formatFullDir(root.source.fullPath),
                    root.key,
                    dirRootActions(root.source)
                ),
                height: 18,
            });
            if (collapsedRoots.has(root.key)) continue;

            const dirSourceKey = root.key;
            const results = filterAndSort(resultsForSource(root.source));
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const isLastResult = i === results.length - 1;
                const expKey = expansionKey(dirSourceKey, r.fullPath);
                const defaultExpanded = expKey === soleImportKey;
                out.push({
                    levels: [],
                    branch: isLastResult ? "ell" : "tee",
                    content: () => resultRow(r, dirSourceKey, defaultExpanded),
                    height: 18,
                });

                if (r.type === "import" && isImportExpanded(expKey, defaultExpanded)) {
                    emitImportContents(out, r, [isLastResult ? "empty" : "vertical"]);
                }
            }
        } else {
            for (let i = 0; i < root.files.length; i++) {
                const file = root.files[i];
                const fileSourceKey = `file:${file.fullPath}`;
                const fileResults = filterAndSort(resultsForSource(file));
                for (let j = 0; j < fileResults.length; j++) {
                    const r = fileResults[j];
                    const expKey = expansionKey(fileSourceKey, r.fullPath);
                    const defaultExpanded = expKey === soleImportKey;
                    out.push({
                        levels: [],
                        branch: null,
                        content: () => resultRow(
                            r,
                            fileSourceKey,
                            defaultExpanded,
                            standaloneCloseAction(file),
                            formatFullDir(file.fullPath)
                        ),
                        height: 18,
                    });

                    if (r.type === "import" && isImportExpanded(expKey, defaultExpanded)) {
                        emitImportContents(out, r, []);
                    }
                }
            }
        }
    }
    return out;
}

export const RESULTS_SCROLL_ID = "left-results-scroll";
const VIRTUAL_OVERSCAN_PX = 96;

// Reveal the home group of a repeat-included file: expand the groups above
// it, rebuild the descriptors, scroll its row into the upper third of the
// viewport, and flash it.
function jumpToIncludeNode(r: ResultImport, targetPath: string): void {
    const ancestors = includeAncestorPaths(includeTreeOf(r), targetPath);
    if (ancestors === null) return;
    for (let i = 0; i < ancestors.length; i++) {
        expandIncludeGroup(includeGroupKey(r.fullPath, ancestors[i]));
    }
    const targetKey = includeGroupKey(r.fullPath, targetPath);
    // Expand the target too — landing on a collapsed group still costs a
    // caret click, which defeats the point of the jump.
    expandIncludeGroup(targetKey);
    setJumpFlash(targetKey);
    bumpTreeRevision();

    const rows = treeRows();
    let y = 0;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].key === targetKey) {
            const viewportH = getScrollState(RESULTS_SCROLL_ID).viewportRect.h;
            setScrollOffset(RESULTS_SCROLL_ID, Math.max(0, y - Math.max(0, viewportH / 3)));
            return;
        }
        y += rows[i].height + ROW_GAP_H;
    }
}

export function renderRows(): Element[] {
    const rows = treeRows();
    if (rows.length === 0) return [];

    let totalH = 0;
    for (let i = 0; i < rows.length; i++) totalH += rows[i].height + ROW_GAP_H;

    const state = getScrollState(RESULTS_SCROLL_ID);
    const viewportH = state.viewportRect.h;
    if (viewportH <= 0) {
        const initial: Element[] = [];
        let initialH = 0;
        const limitH = 420;
        for (let i = 0; i < rows.length && initialH < limitH; i++) {
            initial.push(composeTreeRow(rows[i]));
            initialH += rows[i].height + ROW_GAP_H;
        }
        if (totalH > initialH) initial.push(spacer(1, totalH - initialH));
        return initial;
    }

    const minY = Math.max(0, state.offset - VIRTUAL_OVERSCAN_PX);
    const maxY = state.offset + viewportH + VIRTUAL_OVERSCAN_PX;
    const out: Element[] = [];
    let cursor = 0;
    let visibleH = 0;
    let topPad = 0;
    let started = false;

    for (let i = 0; i < rows.length; i++) {
        const rowH = rows[i].height + ROW_GAP_H;
        const rowStart = cursor;
        const rowEnd = cursor + rowH;
        if (rowEnd >= minY && rowStart <= maxY) {
            if (!started) {
                topPad = rowStart;
                if (topPad > 0) out.push(spacer(1, topPad));
                started = true;
            }
            out.push(composeTreeRow(rows[i]));
            visibleH += rowH;
        } else if (started && rowStart > maxY) {
            break;
        }
        cursor = rowEnd;
    }

    if (!started) {
        out.push(spacer(1, totalH));
        return out;
    }

    const bottomPad = Math.max(0, totalH - topPad - visibleH);
    if (bottomPad > 0) out.push(spacer(1, bottomPad));
    return out;
}
