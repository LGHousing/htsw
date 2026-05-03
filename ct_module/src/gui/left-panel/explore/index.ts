/// <reference types="../../../../CTAutocomplete" />

import { Element } from "../../layout";
import { Button, Col, Container, Input, Row, Scroll, Text } from "../../components";
import { togglePopover } from "../../popovers";
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
import { enumerateResults } from "./source";
import {
    SORT_FIELDS,
    isSortDefault,
    sortResults,
    sortPopoverContent,
} from "./sort";
import {
    isTypeActive,
    isFilterDefault,
    filterPopoverContent,
    FILTER_POPOVER_HEIGHT,
} from "./filter";

let searchQuery = "";
const expandedImports: Set<string> = new Set();

function filteredResults(): Result[] {
    const q = searchQuery.toLowerCase();
    const all = enumerateResults();
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

function resultRow(r: Result): Element {
    const isImport = r.type === "import";
    return Container({
        style: {
            direction: "row",
            padding: [{ side: "left", value: 3 }, { side: "right", value: 6 }],
            gap: 6,
            align: "center",
            height: { kind: "px", value: 18 },
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: () => {
            if (isImport) {
                if (expandedImports.has(r.fullPath)) expandedImports.delete(r.fullPath);
                else expandedImports.add(r.fullPath);
            } else {
                ChatLib.chat(`&a[htsw] clicked ${r.type}: ${r.fullPath}`);
            }
        },
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
            isImport && Text({
                text: expandedImports.has(r.fullPath) ? '[-]' : '[+]',
            }),
        ],
    });
}

function entryContent(parent: ResultImport, e: ImportEntry): Element {
    const refRel = entryRefPath(e);
    const childFull = refRel === undefined ? undefined : joinPath(dirOf(parent.fullPath), refRel);
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
        onClick: () => ChatLib.chat(`&a[htsw] clicked ${e.type}: ${clickPath}`),
        children: [Text({ text: display })],
    });
}

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
    // Center the horizontal arm on the row's vertical center: arm spans
    // [armTopY .. armTopY + LINE_THICK), with armTopY = (rowH - LINE_THICK) / 2.
    const armTopY = Math.floor((rowH - LINE_THICK) / 2);
    const segs: Element[] = [];
    if (armTopY > 0) segs.push(verticalStripCol(armTopY));
    segs.push(pixel(INDENT_STEP, LINE_THICK));
    const bottomH = rowH - armTopY - LINE_THICK;
    if (bottomH > 0) {
        segs.push(kind === "tee" ? verticalStripCol(bottomH) : spacer(INDENT_STEP, bottomH));
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
        cols.push(r.levels[i] === "vertical" ? verticalStripCol(ROW_GAP_H) : emptyStripCol(ROW_GAP_H));
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
            cols.push(r.levels[i] === "vertical" ? verticalStripCol(r.height) : emptyStripCol(r.height));
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

function buildTreeRows(): TreeRow[] {
    const results = filteredResults();
    const out: TreeRow[] = [];
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        out.push({ levels: [], branch: null, content: resultRow(r), height: 18 });
        if (r.type === "import" && expandedImports.has(r.fullPath)) {
            const entries = r.entries;
            for (let j = 0; j < entries.length; j++) {
                const isLast = j === entries.length - 1;
                out.push({
                    levels: [],
                    branch: isLast ? "ell" : "tee",
                    content: entryContent(r, entries[j]),
                    height: ENTRY_ROW_H,
                });
            }
        }
    }
    return out;
}

function renderRows(): Element[] {
    return buildTreeRows().map(composeTreeRow);
}

export function ExploreView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" } },
        children: [
            Row({
                style: { gap: 6, height: { kind: "px", value: 22 }, align: "stretch" },
                children: [
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
                            width: { kind: "px", value: 48 },
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
                            width: { kind: "px", value: 48 },
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
