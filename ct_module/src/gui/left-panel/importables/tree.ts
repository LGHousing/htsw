/// <reference types="../../../../CTAutocomplete" />

import {
    Element,
    getScrollState,
} from "../../lib/layout";
import { Col, Container } from "../../lib/components";
import {
    SourceDir,
    SourceFile,
    enumerateForSource,
    getSources,
} from "./source";
import { sortResults } from "./sort";
import { isImportableTypeActive, isFilterDefault } from "./filter";
import { Result, ResultImport, ROW_BG } from "./rowModel";
import {
    searchQuery,
    expansionKey,
    isImportExpanded,
    collapsedRoots,
    importableExpansion,
    importableExpansionKey,
    subListsOf,
    metadataFieldsOf,
    dirRootKey,
    dirRootActions,
    rootRow,
    resultRow,
    importableRow,
    subRow,
    metadataRow,
    standaloneCloseAction,
} from "./rows";

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

function filterImportables(r: ResultImport): ResultImport["importables"] {
    const q = searchQuery.toLowerCase();
    const pathMatch = q.length === 0 || r.path.toLowerCase().indexOf(q) >= 0;
    const out: ResultImport["importables"] = [];
    for (let j = 0; j < r.importables.length; j++) {
        const imp = r.importables[j];
        if (!isImportableTypeActive(imp.type)) continue;
        if (q.length > 0 && !pathMatch) {
            if (importableName(imp).toLowerCase().indexOf(q) < 0) continue;
        }
        out.push(imp);
    }
    return out;
}

function filterAndSort(all: Result[]): Result[] {
    const hasTypeFilter = !isFilterDefault();
    const q = searchQuery.toLowerCase();
    const out: Result[] = [];
    for (let i = 0; i < all.length; i++) {
        const r = all[i];
        if (hasTypeFilter && r.type !== "import") continue;
        if (r.type === "import") {
            if (filterImportables(r).length === 0) continue;
        } else {
            if (q.length > 0 && r.path.toLowerCase().indexOf(q) < 0) continue;
        }
        out.push(r);
    }
    return sortResults(out);
}

const MAX_TAIL_SEGMENTS = 3;

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

function buildTreeRows(): TreeRow[] {
    const roots = buildRoots();
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
            const results = filterAndSort(enumerateForSource(root.source));
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
                    const importables = filterImportables(r);
                    for (let j = 0; j < importables.length; j++) {
                        const imp = importables[j];
                        const isLastImp = j === importables.length - 1;
                        const impLevels: LevelGuide[] = [
                            isLastResult ? "empty" : "vertical",
                        ];
                        out.push({
                            levels: impLevels,
                            branch: isLastImp ? "ell" : "tee",
                            content: () => importableRow(r, imp),
                            height: ENTRY_ROW_H,
                        });
                        const subKey = importableExpansionKey(r.fullPath, imp);
                        if (importableExpansion.has(subKey)) {
                            const subs = subListsOf(imp);
                            const meta = metadataFieldsOf(imp);
                            const totalChildren = subs.length + meta.length;
                            let childIdx = 0;
                            const childLevels: LevelGuide[] = impLevels.concat([
                                isLastImp ? "empty" : "vertical",
                            ]);
                            for (let k = 0; k < subs.length; k++) {
                                childIdx++;
                                out.push({
                                    levels: childLevels,
                                    branch: childIdx === totalChildren ? "ell" : "tee",
                                    content: () => subRow(r, imp, subs[k]),
                                    height: ENTRY_ROW_H,
                                });
                            }
                            for (let k = 0; k < meta.length; k++) {
                                childIdx++;
                                out.push({
                                    levels: childLevels,
                                    branch: childIdx === totalChildren ? "ell" : "tee",
                                    content: () => metadataRow(r, imp, meta[k]),
                                    height: ENTRY_ROW_H,
                                });
                            }
                        }
                    }
                }
            }
        } else {
            for (let i = 0; i < root.files.length; i++) {
                const file = root.files[i];
                const fileSourceKey = `file:${file.fullPath}`;
                const fileResults = filterAndSort(enumerateForSource(file));
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
                        const importables = filterImportables(r);
                        for (let k = 0; k < importables.length; k++) {
                            const imp = importables[k];
                            const isLastImp = k === importables.length - 1;
                            out.push({
                                levels: [],
                                branch: isLastImp ? "ell" : "tee",
                                content: () => importableRow(r, imp),
                                height: ENTRY_ROW_H,
                            });
                            const subKey = importableExpansionKey(r.fullPath, imp);
                            if (importableExpansion.has(subKey)) {
                                const subs = subListsOf(imp);
                                const meta = metadataFieldsOf(imp);
                                const totalChildren = subs.length + meta.length;
                                let childIdx = 0;
                                const childLevels: LevelGuide[] = [
                                    isLastImp ? "empty" : "vertical",
                                ];
                                for (let s = 0; s < subs.length; s++) {
                                    childIdx++;
                                    out.push({
                                        levels: childLevels,
                                        branch: childIdx === totalChildren ? "ell" : "tee",
                                        content: () => subRow(r, imp, subs[s]),
                                        height: ENTRY_ROW_H,
                                    });
                                }
                                for (let s = 0; s < meta.length; s++) {
                                    childIdx++;
                                    out.push({
                                        levels: childLevels,
                                        branch: childIdx === totalChildren ? "ell" : "tee",
                                        content: () => metadataRow(r, imp, meta[s]),
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

export const RESULTS_SCROLL_ID = "left-results-scroll";
const VIRTUAL_OVERSCAN_PX = 96;

export function renderRows(): Element[] {
    const rows = buildTreeRows();
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
