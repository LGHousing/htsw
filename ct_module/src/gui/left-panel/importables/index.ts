/// <reference types="../../../../CTAutocomplete" />

import { Element } from "../../lib/layout";
import { Button, Col, Container, Input, Row, Scroll, Text } from "../../lib/components";
import { togglePopover } from "../../lib/popovers";
import { openMenu, MenuAction } from "../../lib/menu";
import { openAddImportablePopover } from "../../popovers/add-importable";
import {
    getImportJsonPath,
    getParsedResult,
    getParseError,
    getImportRunRow,
    getImportRunState,
    getSelectedImportableId,
    isImportableChecked,
    setSelectedImportableId,
    toggleImportableChecked,
    openTab,
    type ImportRunRow,
} from "../../state";
import { STATUS_COLOR, STATUS_LABEL, statusForImportable } from "../../knowledge-status";
import { importableIdentity } from "../../../knowledge/paths";
import { trustPlanKey } from "../../../knowledge/trust";
import { confirmSelect } from "../../state/selection";
import {
    hasSubList,
    importableDeclaringJson,
    importableSourcePath,
    importableSubListPath,
    type SubListKind,
} from "../../state/importablePaths";
import { openInVSCode, showInExplorer } from "../../../utils/osShell";
import type { Importable } from "htsw/types";
import {
    ACCENT_INFO,
    ACCENT_ORANGE,
    ACCENT_PURPLE,
    ACCENT_SUCCESS,
    ACCENT_TEAL,
    ACCENT_WARN,
    ACCENT_DANGER,
    COLOR_PANEL_RAISED,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_ROW_SELECTED,
    COLOR_ROW_SELECTED_HOVER,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    GLYPH_CHEVRON_DOWN,
    GLYPH_CHEVRON_RIGHT,
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

function fsActions(fullPath: string, label: string): MenuAction[] {
    return [
        { label: `Open ${label} in VSCode`, onClick: () => openInVSCode(fullPath) },
        { label: `Show ${label} in explorer`, onClick: () => showInExplorer(fullPath) },
    ];
}

/**
 * Build the right-click menu for a row that has a "primary" source file
 * (the htsl for FUNCTION/EVENT, the .snbt for ITEM, the htsl for an
 * action sub-list, etc.). When the primary path equals the declaring
 * import.json — the case for REGION/MENU/NPC and inline-JSON sub-lists —
 * we show only the import.json actions to avoid duplicates.
 */
function buildPrimaryAndJsonMenu(
    primaryPath: string | undefined,
    primaryLabel: string,
    declaringPath: string
): MenuAction[] {
    const out: MenuAction[] = [];
    if (primaryPath !== undefined && primaryPath !== declaringPath) {
        out.push(...fsActions(primaryPath, primaryLabel));
        out.push({ kind: "separator" });
    }
    out.push(...fsActions(declaringPath, "import.json"));
    return out;
}

function importableMenuLabel(imp: Importable): string {
    const path = importableSourcePath(imp);
    if (path === undefined) return "source file";
    return basename(path);
}

function importableLabel(i: Importable): string {
    if (i.type === "EVENT") return i.event;
    return i.name;
}

function importableKey(imp: Importable): string {
    return trustPlanKey(imp.type, importableIdentity(imp));
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

// Identities (`type:identity` strings) of importables whose chevron is
// currently expanded. Reset across module reloads — purely a UI concern.
const expandedImportables: Set<string> = new Set();

function isExpandable(imp: Importable): boolean {
    if (imp.type === "REGION") {
        return hasSubList(imp, "onEnterActions") || hasSubList(imp, "onExitActions");
    }
    if (imp.type === "ITEM") {
        return (
            hasSubList(imp, "leftClickActions") || hasSubList(imp, "rightClickActions")
        );
    }
    return false;
}

function toggleExpansion(imp: Importable): void {
    const id = importableIdentity(imp);
    if (expandedImportables.has(id)) expandedImportables.delete(id);
    else expandedImportables.add(id);
}

type SortDir = "ASC" | "DESC";
type SortFieldId = "alphabetical" | "type";

type SortField = {
    id: SortFieldId;
    label: string;
    precedence: number;
    fallbackDir: SortDir;
    compare: (a: Importable, b: Importable) => number;
};

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
const SUBROW_BG = COLOR_PANEL_RAISED;
const SUBROW_HOVER_BG = COLOR_ROW_HOVER;

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

function matchesFilters(r: Importable): boolean {
    const q = searchQuery.toLowerCase();
    if (!selectedTypes[r.type]) return false;
    if (q.length > 0 && importableLabel(r).toLowerCase().indexOf(q) < 0) return false;
    return true;
}

type FilteredImportables =
    | { kind: "normal"; items: Importable[] }
    | { kind: "importing"; importing: Importable[]; rest: Importable[] };

function filteredResults(): FilteredImportables {
    const parsed = getParsedResult();
    if (parsed === null) return { kind: "normal", items: [] };
    const run = getImportRunState();
    const out: Importable[] = [];
    for (let i = 0; i < parsed.value.length; i++) {
        const r = parsed.value[i];
        if (!matchesFilters(r)) continue;
        out.push(r);
    }
    if (run === null) return { kind: "normal", items: sortResults(out) };
    const importing: Importable[] = [];
    const rest: Importable[] = [];
    for (let i = 0; i < out.length; i++) {
        const key = importableKey(out[i]);
        if (run.rows.has(key)) importing.push(out[i]);
        else rest.push(out[i]);
    }
    importing.sort((a, b) => {
        const ar = run.rows.get(importableKey(a));
        const br = run.rows.get(importableKey(b));
        const ao = ar === undefined ? 999999 : ar.order;
        const bo = br === undefined ? 999999 : br.order;
        return ao - bo;
    });
    return { kind: "importing", importing, rest: sortResults(rest) };
}

function toggleAndHighlight(imp: Importable): void {
    const id = importableIdentity(imp);
    toggleImportableChecked(id);
    setSelectedImportableId(id);
}

/**
 * Type-dispatched "open" action invoked on double-click. FUNCTION/EVENT
 * preview their htsl in the right pane (existing behavior). ITEM jumps to
 * its .snbt. REGION toggles inline expansion (matching the chevron). MENU
 * and NPC fall back to the declaring import.json with a chat note —
 * dedicated panes for them are deferred work.
 */
function dispatchDoubleClick(imp: Importable): void {
    setSelectedImportableId(importableIdentity(imp));
    if (imp.type === "REGION") {
        toggleExpansion(imp);
        return;
    }
    if (imp.type === "MENU") {
        ChatLib.chat("&7[htsw] menu pane TBD — opening import.json");
        const json = importableDeclaringJson(imp);
        openTab({ path: json, label: importableLabel(imp) });
        confirmSelect(json);
        return;
    }
    if (imp.type === "NPC") {
        ChatLib.chat("&7[htsw] npc view TBD — opening import.json");
        const json = importableDeclaringJson(imp);
        openTab({ path: json, label: importableLabel(imp) });
        confirmSelect(json);
        return;
    }
    const path = importableSourcePath(imp);
    if (path === undefined) return;
    openTab({ path, label: importableLabel(imp) });
    confirmSelect(path);
}

const SUB_LIST_LABELS: { [k in SubListKind]: string } = {
    onEnterActions: "Enter actions",
    onExitActions: "Exit actions",
    leftClickActions: "Left click actions",
    rightClickActions: "Right click actions",
};

function subRowsFor(imp: Importable): SubListKind[] {
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

function subRow(parent: Importable, kind: SubListKind): Element {
    const label = SUB_LIST_LABELS[kind];
    const declaring = importableDeclaringJson(parent);
    return Container({
        style: {
            direction: "row",
            padding: [
                { side: "left", value: 22 },
                { side: "right", value: 4 },
            ],
            gap: 6,
            align: "center",
            height: { kind: "px", value: SIZE_ROW_H },
            background: SUBROW_BG,
            hoverBackground: SUBROW_HOVER_BG,
        },
        onClick: (_rect, info) => {
            if (info.isDoubleClickSecond) return;
            const path = importableSubListPath(parent, kind);
            if (info.button === 1) {
                openMenu(
                    info.x,
                    info.y,
                    buildPrimaryAndJsonMenu(
                        path,
                        path === undefined ? "list" : basename(path),
                        declaring
                    )
                );
                return;
            }
            if (info.button !== 0) return;
            if (path !== undefined) {
                openTab({ path, label: `${importableLabel(parent)} · ${label}` });
                // Confirm rather than preview: previewing a sub-row's htsl
                // would clear any previously-pinned preview tab, so jumping
                // between Enter actions ↔ Exit actions on the same region
                // would keep blowing away the other one. Each sub-row click
                // pins so both stay visible.
                confirmSelect(path);
            }
        },
        onDoubleClick: () => {
            const path = importableSubListPath(parent, kind);
            if (path === undefined) return;
            openTab({ path, label: `${importableLabel(parent)} · ${label}` });
            confirmSelect(path);
        },
        children: [
            Text({
                text: "↳",
                color: COLOR_TEXT_FAINT,
                style: { width: { kind: "px", value: 8 } },
            }),
            Text({
                text: label,
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

function chevronCell(imp: Importable): Element {
    const expandable = isExpandable(imp);
    // Always reserve the same horizontal slot so expandable and non-
    // expandable rows column-align. Use a Row with vertical center so the
    // glyph sits on the same baseline as the rest of the row's content
    // (which the parent `align: "center"` does for its own children, but
    // doesn't propagate into nested containers).
    if (!expandable) {
        return Container({
            style: { width: { kind: "px", value: 16 }, height: { kind: "grow" } },
            children: [],
        });
    }
    const id = importableIdentity(imp);
    const expanded = expandedImportables.has(id);
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "left", value: 4 },
            width: { kind: "px", value: 16 },
            height: { kind: "grow" },
            hoverBackground: COLOR_ROW_HOVER,
        },
        onClick: (_rect, info) => {
            if (info.isDoubleClickSecond) return;
            if (info.button !== 0) return;
            toggleExpansion(imp);
        },
        children: [
            Text({
                text: expanded ? GLYPH_CHEVRON_DOWN : GLYPH_CHEVRON_RIGHT,
                color: ACCENT_INFO,
            }),
        ],
    });
}

function runStatusForImportable(imp: Importable): ImportRunRow | null {
    if (getImportRunState() === null) return null;
    return getImportRunRow(importableKey(imp));
}

function runStatusGlyph(row: ImportRunRow | null): string {
    if (row === null) return " ";
    if (row.status === "queued") return "·";
    if (row.status === "current") return GLYPH_CHEVRON_RIGHT;
    if (row.status === "imported") return "✓";
    if (row.status === "skipped") return "≈";
    return "!";
}

function runStatusColor(row: ImportRunRow | null): number {
    if (row === null) return COLOR_TEXT_FAINT;
    if (row.status === "queued") return COLOR_TEXT_FAINT;
    if (row.status === "current") return ACCENT_INFO;
    if (row.status === "imported") return ACCENT_SUCCESS;
    if (row.status === "skipped") return COLOR_TEXT_DIM;
    return ACCENT_DANGER;
}

function runStatusTooltip(row: ImportRunRow | null): string {
    if (row === null) return "Not in this import";
    if (row.status === "queued") return `Queued #${row.order + 1}`;
    if (row.status === "imported") return "Imported";
    if (row.status === "skipped") return "Skipped: trusted cache current";
    if (row.status === "failed") return "Failed";
    const unit =
        row.unitTotal > 0 ? ` · ${row.unitCompleted}/${row.unitTotal}` : "";
    return `Importing · ${row.phase} · ${row.phaseLabel}${unit}`;
}

function runStatusCell(imp: Importable): Element | false {
    if (getImportRunState() === null) return false;
    const row = runStatusForImportable(imp);
    return Text({
        text: runStatusGlyph(row),
        color: runStatusColor(row),
        tooltip: runStatusTooltip(row),
        tooltipColor: runStatusColor(row),
        style: { width: { kind: "px", value: 8 } },
    });
}

function separatorRow(label: string): Element {
    return Container({
        style: {
            direction: "row",
            padding: { side: "x", value: 6 },
            align: "center",
            height: { kind: "px", value: 12 },
            background: COLOR_PANEL_RAISED,
        },
        children: [
            Text({
                text: label,
                color: COLOR_TEXT_FAINT,
                style: { width: { kind: "grow" } },
            }),
        ],
    });
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
                openMenu(
                    info.x,
                    info.y,
                    buildPrimaryAndJsonMenu(
                        importableSourcePath(r),
                        importableMenuLabel(r),
                        importableDeclaringJson(r)
                    )
                );
                return;
            }
            if (info.button !== 0) return;
            toggleAndHighlight(r);
        },
        onDoubleClick: () => dispatchDoubleClick(r),
        children: [
            chevronCell(r),
            // Multi-select checkbox.
            Text({
                text: isChecked ? "[x]" : "[ ]",
                color: isChecked ? ACCENT_SUCCESS : COLOR_TEXT_DIM,
                style: { width: { kind: "px", value: 14 } },
            }),
            runStatusCell(r),
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

function rowAndChildren(r: Importable): Element[] {
    const out: Element[] = [resultRow(r)];
    if (!isExpandable(r)) return out;
    if (!expandedImportables.has(importableIdentity(r))) return out;
    const kinds = subRowsFor(r);
    for (let i = 0; i < kinds.length; i++) out.push(subRow(r, kinds[i]));
    return out;
}

function appendRows(out: Element[], items: Importable[]): void {
    for (let i = 0; i < items.length; i++) {
        const sub = rowAndChildren(items[i]);
        for (let j = 0; j < sub.length; j++) out.push(sub[j]);
    }
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
                    // Add a blank stub entry to import.json. Lives next to
                    // Sort/Filter because it's another list-management
                    // affordance — moved here from the top toolbar when
                    // that slot was repurposed for Alias.
                    Button({
                        text: "+",
                        style: {
                            width: { kind: "px", value: 18 },
                            height: { kind: "grow" },
                        },
                        onClick: (rect) => openAddImportablePopover(rect),
                    }),
                ],
            }),
            Scroll({
                id: "importables-results-scroll",
                style: { gap: 2, height: { kind: "grow" } },
                children: () => {
                    const grouped = filteredResults();
                    const out: Element[] = [];
                    if (grouped.kind === "normal") {
                        if (grouped.items.length === 0) return [emptyState()];
                        appendRows(out, grouped.items);
                        return out;
                    }
                    if (grouped.importing.length === 0 && grouped.rest.length === 0) return [emptyState()];
                    appendRows(out, grouped.importing);
                    if (grouped.importing.length > 0 && grouped.rest.length > 0) {
                        out.push(separatorRow("Not importing"));
                    }
                    appendRows(out, grouped.rest);
                    return out;
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
                                openMenu(info.x, info.y, fsActions(path, "import.json"));
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
                                openMenu(info.x, info.y, fsActions(folder, "folder"));
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
