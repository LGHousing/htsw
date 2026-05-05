/// <reference types="../../../../CTAutocomplete" />

import { Element } from "../../lib/layout";
import { Button, Col, Container, Input, Row, Scroll, Text } from "../../lib/components";
import { togglePopover } from "../../lib/popovers";
import { openMenu, MenuAction } from "../../lib/menu";
import {
    getImportJsonPath,
    getParsedResult,
    getParseError,
    getSelectedImportableId,
    isImportableChecked,
    setSelectedImportableId,
    toggleImportableChecked,
    openTab,
} from "../../state";
import { STATUS_COLOR, STATUS_LABEL, statusForImportable } from "../../knowledge-status";
import { importableIdentity } from "../../../knowledge/paths";
import { previewSelect, confirmSelect } from "../../state/selection";
import { openInVSCode, showInExplorer } from "../../../utils/osShell";
import type { Importable } from "htsw/types";
import {
    ACCENT_INFO,
    ACCENT_ORANGE,
    ACCENT_PURPLE,
    ACCENT_SUCCESS,
    ACCENT_TEAL,
    ACCENT_WARN,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_ROW_SELECTED,
    COLOR_ROW_SELECTED_HOVER,
    COLOR_TEXT_DIM,
    GLYPH_DOT,
    SIZE_ROW_H,
} from "../../lib/theme";

type ImportableType = Importable["type"];
const ALL_TYPES: ImportableType[] = [
    "FUNCTION",
    "EVENT",
    "REGION",
    "ITEM",
    "MENU",
    "NPC",
];

const TYPE_COLORS: { [k in ImportableType]: number } = {
    FUNCTION: ACCENT_INFO,
    EVENT: ACCENT_PURPLE,
    REGION: ACCENT_SUCCESS,
    ITEM: ACCENT_WARN,
    MENU: ACCENT_ORANGE,
    NPC: ACCENT_TEAL,
};

function statusTooltip(state: keyof typeof STATUS_LABEL): string {
    const lbl = STATUS_LABEL[state];
    return lbl.charAt(0).toUpperCase() + lbl.substring(1);
}

function basename(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? norm : norm.substring(slash + 1);
}

function dirname(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? "" : norm.substring(0, slash);
}

function fsActions(fullPath: string): MenuAction[] {
    return [
        { label: "Show in explorer", onClick: () => showInExplorer(fullPath) },
        { label: "Open with VSCode", onClick: () => openInVSCode(fullPath) },
    ];
}

function importableSourcePath(imp: Importable): string | undefined {
    const parsed = getParsedResult();
    if (parsed === null) return undefined;
    // For ITEM, gcx.sourceFiles intentionally points to the declaring
    // import.json (see context.ts). The actual .snbt file is what the user
    // wants to open — the parsed `nbt` Tag's span resolves to it via the
    // source map because parseSnbt registers the .snbt file there.
    if (imp.type === "ITEM" && imp.nbt !== undefined) {
        try {
            const span = parsed.gcx.spans.get(imp.nbt);
            return parsed.gcx.sourceMap.getFileByPos(span.start).path;
        } catch (_e) {
            // Fall through to the declaring file.
        }
    }
    return parsed.gcx.sourceFiles.get(imp);
}

let searchQuery = "";
let selectedTypes: { [k in ImportableType]: boolean } = {
    FUNCTION: true,
    EVENT: true,
    REGION: true,
    ITEM: true,
    MENU: true,
    NPC: true,
};

type SortDir = "ASC" | "DESC";
type SortFieldId = "alphabetical" | "type";

type SortField = {
    id: SortFieldId;
    label: string;
    precedence: number;
    fallbackDir: SortDir;
    compare: (a: Importable, b: Importable) => number;
};

function importableLabel(i: Importable): string {
    if (i.type === "EVENT") return i.event;
    return i.name;
}

const SORT_FIELDS: SortField[] = [
    {
        id: "alphabetical",
        label: "Alphabetically",
        precedence: 0,
        fallbackDir: "ASC",
        compare: (a, b) => {
            const an = importableLabel(a);
            const bn = importableLabel(b);
            return an < bn ? -1 : an > bn ? 1 : 0;
        },
    },
    {
        id: "type",
        label: "By type",
        precedence: 1,
        fallbackDir: "ASC",
        compare: (a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
    },
];

const DEFAULT_SORT: { id: SortFieldId; direction: SortDir } = {
    id: "alphabetical",
    direction: "ASC",
};
let activeSort: { id: SortFieldId; direction: SortDir } = DEFAULT_SORT;

function getSortField(id: SortFieldId): SortField {
    for (let i = 0; i < SORT_FIELDS.length; i++)
        if (SORT_FIELDS[i].id === id) return SORT_FIELDS[i];
    return SORT_FIELDS[0];
}

function applyDir(cmp: number, dir: SortDir): number {
    return dir === "ASC" ? cmp : -cmp;
}

function sortResults(rs: Importable[]): Importable[] {
    const primary = getSortField(activeSort.id);
    const fallbacks: SortField[] = [];
    for (let i = 0; i < SORT_FIELDS.length; i++)
        if (SORT_FIELDS[i].id !== primary.id) fallbacks.push(SORT_FIELDS[i]);
    fallbacks.sort((a, b) => b.precedence - a.precedence);
    return rs.slice().sort((a, b) => {
        const c = applyDir(primary.compare(a, b), activeSort.direction);
        if (c !== 0) return c;
        for (let i = 0; i < fallbacks.length; i++) {
            const fc = applyDir(fallbacks[i].compare(a, b), fallbacks[i].fallbackDir);
            if (fc !== 0) return fc;
        }
        return 0;
    });
}

function isSortDefault(): boolean {
    return (
        activeSort.id === DEFAULT_SORT.id &&
        activeSort.direction === DEFAULT_SORT.direction
    );
}

function isFilterDefault(): boolean {
    return ALL_TYPES.every((t) => selectedTypes[t] === true);
}

const ACTIVE_BG = 0xff2d4d2d | 0;
const ACTIVE_HOVER_BG = 0xff3a5d3a | 0;
const ROW_BG = COLOR_ROW;
const ROW_HOVER_BG = COLOR_ROW_HOVER;
const SELECTED_BG = COLOR_ROW_SELECTED;
const SELECTED_HOVER_BG = COLOR_ROW_SELECTED_HOVER;

function selectSort(id: SortFieldId): void {
    if (activeSort.id === id) {
        activeSort.direction = activeSort.direction === "ASC" ? "DESC" : "ASC";
    } else {
        activeSort = { id, direction: getSortField(id).fallbackDir };
    }
}

function toggleType(t: ImportableType): void {
    selectedTypes[t] = !selectedTypes[t];
}

function filteredResults(): Importable[] {
    const parsed = getParsedResult();
    if (parsed === null) return [];
    const q = searchQuery.toLowerCase();
    const out: Importable[] = [];
    for (let i = 0; i < parsed.value.length; i++) {
        const r = parsed.value[i];
        if (!selectedTypes[r.type]) continue;
        if (q.length > 0 && importableLabel(r).toLowerCase().indexOf(q) < 0) continue;
        out.push(r);
    }
    return sortResults(out);
}

function toggleAndHighlight(imp: Importable): void {
    const id = importableIdentity(imp);
    toggleImportableChecked(id);
    setSelectedImportableId(id);
}

function openImportable(imp: Importable, pin: boolean): void {
    setSelectedImportableId(importableIdentity(imp));
    const parsed = getParsedResult();
    if (parsed === null) return;
    const path = parsed.gcx.sourceFiles.get(imp);
    if (path === undefined) return;
    openTab({ path, label: importableLabel(imp) });
    if (pin) confirmSelect(path);
    else previewSelect(path);
}

function resultRow(r: Importable): Element {
    const id = importableIdentity(r);
    const isHighlighted = getSelectedImportableId() === id;
    const isChecked = isImportableChecked(id);
    const status = statusForImportable(r);
    return Container({
        style: {
            direction: "row",
            padding: { side: "x", value: 4 },
            gap: 6,
            align: "center",
            height: { kind: "px", value: SIZE_ROW_H },
            background: isHighlighted ? SELECTED_BG : ROW_BG,
            hoverBackground: isHighlighted ? SELECTED_HOVER_BG : ROW_HOVER_BG,
        },
        onClick: (_rect, info) => {
            // The first click of a double-click pair already toggled the
            // checkbox; don't untoggle it on the second click.
            if (info.isDoubleClickSecond) return;
            if (info.button === 1) {
                const path = importableSourcePath(r);
                if (path !== undefined) openMenu(info.x, info.y, fsActions(path));
                return;
            }
            if (info.button !== 0) return;
            toggleAndHighlight(r);
        },
        onDoubleClick: () => openImportable(r, true),
        children: [
            // Multi-select checkbox.
            Text({
                text: isChecked ? "[x]" : "[ ]",
                color: isChecked ? ACCENT_SUCCESS : COLOR_TEXT_DIM,
                style: { width: { kind: "px", value: 14 } },
            }),
            // Knowledge-status dot — hover shows the status label.
            Text({
                text: GLYPH_DOT,
                color: STATUS_COLOR[status],
                tooltip: statusTooltip(status),
                tooltipColor: STATUS_COLOR[status],
                style: { width: { kind: "px", value: 6 } },
            }),
            Text({ text: importableLabel(r), style: { width: { kind: "grow" } } }),
            Text({ text: r.type, color: COLOR_TEXT_DIM }),
        ],
    });
}

function sortPopoverContent(): Element {
    return Scroll({
        id: "importables-sort-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () =>
            SORT_FIELDS.map((f) => {
                const on = activeSort.id === f.id;
                return Container({
                    style: {
                        direction: "row",
                        align: "center",
                        padding: { side: "x", value: 6 },
                        gap: 6,
                        height: { kind: "px", value: 18 },
                        background: on ? ACTIVE_BG : ROW_BG,
                        hoverBackground: on ? ACTIVE_HOVER_BG : ROW_HOVER_BG,
                    },
                    onClick: () => selectSort(f.id),
                    children: [
                        Text({ text: f.label, style: { width: { kind: "grow" } } }),
                        Text({
                            text: on ? `[${activeSort.direction}]` : "",
                            color: 0xff888888 | 0,
                        }),
                    ],
                });
            }),
    });
}

function filterPopoverContent(): Element {
    return Scroll({
        id: "importables-filter-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () =>
            ALL_TYPES.map((t) => {
                const on = selectedTypes[t] === true;
                return Container({
                    style: {
                        direction: "row",
                        align: "center",
                        padding: { side: "x", value: 6 },
                        gap: 6,
                        height: { kind: "px", value: 18 },
                        background: on ? ACTIVE_BG : ROW_BG,
                        hoverBackground: on ? ACTIVE_HOVER_BG : ROW_HOVER_BG,
                    },
                    onClick: () => toggleType(t),
                    children: [
                        Container({
                            style: {
                                width: { kind: "px", value: 6 },
                                height: { kind: "px", value: 12 },
                                background: TYPE_COLORS[t],
                            },
                            children: [],
                        }),
                        Text({ text: t, style: { width: { kind: "grow" } } }),
                        Text({ text: on ? "[x]" : "[ ]" }),
                    ],
                });
            }),
    });
}

function emptyState(): Element {
    return Container({
        style: { padding: 6, height: { kind: "grow" } },
        children: () => {
            const err = getParseError();
            if (err !== null) {
                return [
                    Text({ text: "Parse error:", color: 0xffe85c5c | 0 }),
                    Text({ text: err, style: { width: { kind: "grow" } } }),
                ];
            }
            const parsed = getParsedResult();
            if (parsed === null) {
                return [
                    Text({
                        text: "No import.json loaded — click Browse.",
                        color: 0xff888888 | 0,
                    }),
                ];
            }
            if (parsed.value.length === 0) {
                let errors = 0;
                let warnings = 0;
                let firstErr = "";
                for (let i = 0; i < parsed.diagnostics.length; i++) {
                    const d = parsed.diagnostics[i];
                    if (d.level === "error" || d.level === "bug") {
                        errors++;
                        if (firstErr === "") firstErr = d.message;
                    } else if (d.level === "warning") {
                        warnings++;
                    }
                }
                const out: Element[] = [
                    Text({
                        text: "No importables loaded.",
                        color: 0xff888888 | 0,
                    }),
                ];
                if (errors > 0 || warnings > 0) {
                    out.push(
                        Text({
                            text: `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"} during parse.`,
                            color: errors > 0 ? 0xffe85c5c | 0 : 0xffe5bc4b | 0,
                        })
                    );
                    if (firstErr.length > 0) {
                        out.push(
                            Text({
                                text: `· ${firstErr}`,
                                style: { width: { kind: "grow" } },
                            })
                        );
                    }
                } else {
                    out.push(
                        Text({
                            text: "(file parsed cleanly but contains no entries)",
                            color: 0xff666666 | 0,
                        })
                    );
                }
                return out;
            }
            return [];
        },
    });
}

export function ImportablesView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" }, padding: 4 },
        children: [
            Row({
                style: { gap: 4, height: { kind: "px", value: 22 }, align: "stretch" },
                children: [
                    Input({
                        id: "importables-search",
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
                            width: { kind: "px", value: 36 },
                            height: { kind: "grow" },
                            background: () => (isSortDefault() ? undefined : ACTIVE_BG),
                            hoverBackground: () =>
                                isSortDefault() ? undefined : ACTIVE_HOVER_BG,
                        },
                        onClick: (rect) => {
                            togglePopover({
                                key: "importables-sort",
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
                            background: () =>
                                isFilterDefault() ? undefined : ACTIVE_BG,
                            hoverBackground: () =>
                                isFilterDefault() ? undefined : ACTIVE_HOVER_BG,
                        },
                        onClick: (rect) => {
                            togglePopover({
                                key: "importables-filter",
                                anchor: rect,
                                content: filterPopoverContent(),
                                width: 140,
                                height: Math.min(180, ALL_TYPES.length * 20 + 6),
                            });
                        },
                    }),
                ],
            }),
            Scroll({
                id: "importables-results-scroll",
                style: { gap: 2, height: { kind: "grow" } },
                children: () => {
                    const items = filteredResults();
                    if (items.length === 0) return [emptyState()];
                    return items.map(resultRow);
                },
            }),
            Row({
                style: {
                    gap: 4,
                    width: { kind: "grow" },
                    height: { kind: "px", value: 18 },
                },
                children: [
                    Button({
                        text: "Grab All Items [TODO]",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                        },
                        onClick: () =>
                            ChatLib.chat("&7[htsw] Grab All Items not implemented"),
                    }),
                    Button({
                        text: () => `Open ${basename(getImportJsonPath())}`,
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                        },
                        onClick: (_rect, info) => {
                            if (info.isDoubleClickSecond) return;
                            const path = getImportJsonPath();
                            if (info.button === 1) {
                                openMenu(info.x, info.y, fsActions(path));
                                return;
                            }
                            if (info.button !== 0) return;
                            openInVSCode(path);
                        },
                    }),
                    Button({
                        text: "Open Folder",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                        },
                        onClick: (_rect, info) => {
                            if (info.isDoubleClickSecond) return;
                            const folder = dirname(getImportJsonPath());
                            if (info.button === 1) {
                                openMenu(info.x, info.y, fsActions(folder));
                                return;
                            }
                            if (info.button !== 0) return;
                            openInVSCode(folder);
                        },
                    }),
                ],
            }),
        ],
    });
}
