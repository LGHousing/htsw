/// <reference types="../../../../CTAutocomplete" />

import { Element, Rect } from "../../lib/layout";
import { Button, Col, Container, Icon, Input, Row, Scroll, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import type { IconName } from "../../lib/icons.generated";
import {
    getEffectiveNewExportTarget,
    getExportImportJsonPath,
    getHousingUuid,
    isHouseTrusted,
} from "../../state";
import { GLYPH_DOT } from "../../lib/theme";
import { basename, dirname, shortPath } from "../../lib/pathDisplay";
import { requestParse } from "../../parsing/parses";
import { openConfirmPopover } from "../../popovers/confirm";
import { openMenu, type MenuAction } from "../../lib/menu";
import { togglePopover } from "../../lib/popovers";
import { exportDestinationPicker } from "../../export/destinationPicker";
import {
    clearExportSelection,
    getExportSelection,
    isInExportSelection,
    toggleExportSelection,
} from "./exportSelection";
import { importableIdentity } from "../../../importables/identity";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_ROW_SELECTED,
    COLOR_ROW_SELECTED_HOVER,
    COLOR_TAB,
    COLOR_TAB_ACTIVE,
    COLOR_TAB_ACTIVE_HOVER,
    COLOR_TAB_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    SIZE_ROW_H,
} from "../../lib/theme";
import { HOUSE_CONTENT_TYPES, type HouseContentType } from "./contentTypes";
import { type HouseImportable } from "../../../importCache/cache";
import { buildCacheStatusRow } from "../../../importCache/status";
import { confirmSelect } from "../../right-panel/selection";
import { importableSourcePath } from "../../parsing/importablePaths";
import { linkStatusIcon, type LinkStatusKey } from "../../cache-status";
import {
    optionRow,
    statusFilterPopoverContent,
    statusFilterPopoverWidth,
    STATUS_FILTER_POPOVER_HEIGHT,
    FILTER_ACTIVE_BG,
    FILTER_ACTIVE_HOVER_BG,
} from "../statusFilter";
import type { Importable } from "htsw/types";
import { TAB_GAP, tabLabelsFit } from "../tabs";
import { ImportableIcon } from "../../importableVisuals";

// Rhino lacks String.prototype.repeat, so cycle through a fixed table.
const SCAN_DOTS = ["", ".", "..", "..."];

function scanLabel(t: HouseContentType, uuid: string | null): string {
    if (t.scanInFlight()) {
        return `Scanning${SCAN_DOTS[Math.floor(Date.now() / 350) % SCAN_DOTS.length]}`;
    }
    return t.scanned(uuid) ? "Rescan" : "Scan";
}

let activeContentType: HouseContentType["type"] = HOUSE_CONTENT_TYPES[0].type;
let itemSearch = "";
const SCAN_BUTTON_W = 22;

// Status narrowing for the shown type. The type tabs already scope by type, so
// this page only offers the status half of the Projects filter.
const selectedHouseStatuses: Set<LinkStatusKey> = new Set();

function toggleHouseStatus(key: LinkStatusKey): void {
    if (selectedHouseStatuses.has(key)) selectedHouseStatuses.delete(key);
    else selectedHouseStatuses.add(key);
}

type HouseSortId = "alphabetical" | "status";
type HouseSortDir = "ASC" | "DESC";
const HOUSE_SORT_FIELDS: { id: HouseSortId; label: string }[] = [
    { id: "alphabetical", label: "Alphabetically" },
    { id: "status", label: "By status" },
];
// Actionable-first when sorting by status: rows that differ from your files
// come before matches and the rest.
const STATUS_SORT_ORDER: LinkStatusKey[] = ["differs", "matches", "present", "oneSided", "unknown"];
const DEFAULT_HOUSE_SORT: { id: HouseSortId; direction: HouseSortDir } = {
    id: "alphabetical",
    direction: "ASC",
};
let houseSort: { id: HouseSortId; direction: HouseSortDir } = {
    id: "alphabetical",
    direction: "ASC",
};

function isHouseSortDefault(): boolean {
    return houseSort.id === DEFAULT_HOUSE_SORT.id && houseSort.direction === DEFAULT_HOUSE_SORT.direction;
}

function selectHouseSort(id: HouseSortId): void {
    if (houseSort.id === id) {
        houseSort.direction = houseSort.direction === "ASC" ? "DESC" : "ASC";
    } else {
        houseSort = { id, direction: "ASC" };
    }
}

function compareHouseRows(
    a: { item: HouseImportable; state: HouseLinkState },
    b: { item: HouseImportable; state: HouseLinkState }
): number {
    const an = (a.item.label ?? a.item.name).toLowerCase();
    const bn = (b.item.label ?? b.item.name).toLowerCase();
    const alpha = an < bn ? -1 : an > bn ? 1 : 0;
    let c = alpha;
    if (houseSort.id === "status") {
        c =
            STATUS_SORT_ORDER.indexOf(HOUSE_LINK_VISUAL[a.state].key) -
            STATUS_SORT_ORDER.indexOf(HOUSE_LINK_VISUAL[b.state].key);
        if (c === 0) c = alpha;
    }
    return houseSort.direction === "ASC" ? c : -c;
}

function activeType(): HouseContentType {
    for (let i = 0; i < HOUSE_CONTENT_TYPES.length; i++) {
        if (HOUSE_CONTENT_TYPES[i].type === activeContentType) return HOUSE_CONTENT_TYPES[i];
    }
    return HOUSE_CONTENT_TYPES[0];
}

function typeTabButton(t: HouseContentType, showLabel: boolean): Element {
    const isActive = activeContentType === t.type;
    const children: Element[] = [
        Icon({
            name: t.icon,
            tooltip: showLabel ? undefined : t.label,
            tooltipColor: COLOR_TEXT,
        }),
    ];
    if (showLabel) {
        children.push(
            Text({ text: t.label, truncate: true, style: { width: { kind: "grow" } } })
        );
    }
    return Button({
        children,
        style: {
            width: { kind: "grow" },
            height: { kind: "grow" },
            background: isActive ? COLOR_TAB_ACTIVE : COLOR_TAB,
            hoverBackground: isActive ? COLOR_TAB_ACTIVE_HOVER : COLOR_TAB_HOVER,
        },
        onClick: () => {
            activeContentType = t.type;
        },
    });
}

function rescanButton(t: HouseContentType, uuid: string | null): Element {
    return Button({
        style: {
            width: { kind: "px", value: SCAN_BUTTON_W },
            height: { kind: "grow" },
            background: COLOR_BUTTON,
            hoverBackground: COLOR_BUTTON_HOVER,
        },
        onClick: () => {
            if (!t.scanInFlight()) t.scan();
        },
        children: [
            Icon({
                name: Icons.refreshCw,
                // "names" + "(fast)" to set it apart from the slow deep Read,
                // which lives in the export dropdown ("Read … into knowledge").
                tooltip: () => {
                    const l = scanLabel(t, uuid);
                    return l.indexOf("Scanning") === 0 ? l : `${l} names (fast)`;
                },
                tooltipColor: COLOR_TEXT_DIM,
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                },
            }),
        ],
    });
}

// The search bar is the rescan button's home: it stays put through the
// not-scanned and empty states so the button is always in the same place,
// instead of hiding as a small icon in the tab strip.
// The sort/filter buttons mirror the Projects bar: no background until active
// (then the same green tint), so only the refresh button — which keeps its
// button background — reads as a distinct action.
// Background must be a function: passing a bare `undefined` value makes Button
// fall back to its default COLOR_BUTTON box, which is what boxed these controls.
// A function that returns undefined reads as "no background", like the Projects
// sort/filter buttons.
function barControlButton(
    iconName: IconName,
    isActive: () => boolean,
    tooltip: string,
    onClick: (rect: Rect) => void
): Element {
    return Button({
        style: {
            width: { kind: "px", value: SCAN_BUTTON_W },
            height: { kind: "grow" },
            background: () => (isActive() ? FILTER_ACTIVE_BG : undefined),
            hoverBackground: () => (isActive() ? FILTER_ACTIVE_HOVER_BG : undefined),
        },
        onClick: (rect) => onClick(rect),
        children: [
            Icon({
                name: iconName,
                tooltip,
                tooltipColor: COLOR_TEXT_DIM,
                style: { width: { kind: "px", value: 12 }, height: { kind: "px", value: 12 } },
            }),
        ],
    });
}

function houseSortButton(): Element {
    return barControlButton(Icons.arrowUpDown, () => !isHouseSortDefault(), "Sort", (rect) => {
        togglePopover({
            key: "houses-sort",
            anchor: rect,
            content: houseSortPopoverContent(),
            width: 140,
            height: HOUSE_SORT_FIELDS.length * 20 + 6,
        });
    });
}

function houseStatusFilterButton(): Element {
    return barControlButton(Icons.filter, () => selectedHouseStatuses.size > 0, "Filter by status", (rect) => {
        togglePopover({
            key: "houses-status-filter",
            anchor: rect,
            content: statusFilterPopoverContent(selectedHouseStatuses, toggleHouseStatus),
            width: statusFilterPopoverWidth(),
            height: STATUS_FILTER_POPOVER_HEIGHT,
        });
    });
}

function houseSortPopoverContent(): Element {
    return Scroll({
        id: "houses-sort-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () =>
            HOUSE_SORT_FIELDS.map((f) => {
                const on = houseSort.id === f.id;
                return optionRow(
                    on,
                    () => selectHouseSort(f.id),
                    null,
                    f.label,
                    on ? `[${houseSort.direction}]` : ""
                );
            }),
    });
}

function searchRow(t: HouseContentType, uuid: string | null, canScan: boolean): Element {
    const children: Element[] = [
        Input({
            id: "houses-item-search",
            value: () => itemSearch,
            onChange: (v) => {
                itemSearch = v;
            },
            placeholder: `Search ${t.label.toLowerCase()}…`,
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: SIZE_ROW_H + 6 },
            },
        }),
    ];
    children.push(houseSortButton());
    children.push(houseStatusFilterButton());
    if (canScan) children.push(rescanButton(t, uuid));
    return Row({
        style: { gap: 4, height: { kind: "px", value: SIZE_ROW_H + 6 } },
        children,
    });
}

// The source file (htsl/.snbt/json) for an importable in the selected
// import.json, or null if it isn't in your file. Called on right-click, not per
// frame, so re-resolving through the (cached) parse is fine.
function sourcePathForImportable(type: HouseContentType["type"], name: string): string | null {
    const dest = getExportImportJsonPath();
    if (dest.trim() === "") return null;
    const parse = requestParse(dest);
    if (parse === null || parse.parsed === null) return null;
    for (const imp of parse.parsed.value) {
        if (imp.type === type && importableIdentity(imp) === name) {
            return importableSourcePath(imp) ?? null;
        }
    }
    return null;
}

function itemRowMenu(t: HouseContentType, uuid: string, name: string, canExport: boolean): MenuAction[] {
    const actions: MenuAction[] = [];
    // Reuse the existing View-tab diff (source vs cached house content) rather
    // than building a diff here — only when the importable is in your file.
    const sourcePath = sourcePathForImportable(t.type, name);
    if (sourcePath !== null) {
        actions.push({
            label: "View diff",
            icon: Icons.eye,
            onClick: () => {
                confirmSelect(sourcePath, getExportImportJsonPath());
            },
        });
    }
    for (const a of t.rowActions ?? []) {
        actions.push({ label: a.label, icon: a.icon, onClick: () => a.run(name) });
    }
    if (canExport) {
        const selected = isInExportSelection(uuid, t.type, name);
        actions.push({
            label: selected ? "Deselect" : "Select for export",
            icon: selected ? Icons.squareCheck : Icons.square,
            onClick: () => {
                toggleExportSelection({ uuid, type: t.type, name });
            },
        });
    }
    if (t.remove !== undefined) {
        actions.push({ kind: "separator" });
        actions.push({ label: "Delete", icon: Icons.trash2, onClick: () => t.remove?.(name) });
    }
    return actions;
}

// Identities of this type already present in the selected export destination,
// so a row can show whether it's already been written there. Empty until the
// destination has been parsed off-frame (requestParse never blocks render), so
// the dots light up a beat after a big destination is selected rather than
// freezing the client on selection.
function exportedIdentities(type: HouseContentType["type"]): Set<string> {
    const out = new Set<string>();
    const dest = getExportImportJsonPath();
    if (dest.trim() === "") return out;
    const parse = requestParse(dest);
    if (parse === null || parse.parsed === null) return out;
    for (const imp of parse.parsed.value) {
        if (imp.type === type) out.add(importableIdentity(imp));
    }
    return out;
}

type HouseLinkState =
    | "house-only"
    | "exists-in-house"
    | "unread"
    | "matches-knowledge"
    | "differs-from-knowledge";

// House-side wording for the shared link-status icons. The Projects page
// maps the same keys with file-side phrasing — keep these answering "what does
// this house row mean?", not "what import/export action will run?".
const HOUSE_LINK_VISUAL: {
    [k in HouseLinkState]: { key: LinkStatusKey; tooltip: string };
} = {
    "house-only": { key: "oneSided", tooltip: "Only in this house" },
    "exists-in-house": { key: "present", tooltip: "Also in your files" },
    unread: { key: "present", tooltip: "Also in your files; content not read yet" },
    "matches-knowledge": { key: "matches", tooltip: "Matches your files" },
    "differs-from-knowledge": { key: "differs", tooltip: "Differs from your files" },
};

// Source importables (from the selected import.json) keyed by identity, so each
// row can be diffed against your file. Non-blocking parse — null until warm.
function loadedSourceImportablesByType(
    type: HouseContentType["type"]
): Map<string, Importable> | null {
    const out = new Map<string, Importable>();
    const dest = getExportImportJsonPath();
    if (dest.trim() === "") return out;
    const parse = requestParse(dest);
    if (parse === null || parse.parsed === null) return null;
    for (const imp of parse.parsed.value) {
        if (imp.type === type) out.set(importableIdentity(imp), imp);
    }
    return out;
}

function sourceImportablesByType(type: HouseContentType["type"]): Map<string, Importable> {
    return loadedSourceImportablesByType(type) ?? new Map<string, Importable>();
}

function houseLinkStateFor(
    uuid: string | null,
    item: HouseImportable,
    sourceByKey: Map<string, Importable>,
    trusted: boolean
): HouseLinkState {
    const source = sourceByKey.get(item.name);
    if (source === undefined) return "house-only";
    if (!trusted) return "exists-in-house";
    if (uuid === null || !item.verified) return "unread";
    const state = buildCacheStatusRow(uuid, source).state;
    if (state === "current") return "matches-knowledge";
    if (state === "modified") return "differs-from-knowledge";
    return "unread";
}

function itemRowActionButton(
    action: NonNullable<HouseContentType["rowActions"]>[number],
    name: string
): Element {
    return Container({
        style: {
            direction: "col",
            align: "center",
            justify: "center",
            width: { kind: "px", value: 16 },
            height: { kind: "grow" },
            hoverBackground: COLOR_BUTTON_HOVER,
        },
        onClick: (_rect, info) => {
            if (info.button !== 0 || info.isDoubleClickSecond) return;
            action.run(name);
        },
        children: [
            Icon({
                name: action.icon,
                color: COLOR_TEXT_DIM,
                tooltip: action.label,
                tooltipColor: COLOR_TEXT_DIM,
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                },
            }),
        ],
    });
}

function itemRow(
    t: HouseContentType,
    uuid: string,
    item: HouseImportable,
    interactive: boolean,
    canExport: boolean,
    state: HouseLinkState
): Element {
    const inSelection = isInExportSelection(uuid, t.type, item.name);
    const selected = canExport && inSelection;
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 6 },
            gap: 6,
            height: { kind: "px", value: SIZE_ROW_H },
            background: selected ? COLOR_ROW_SELECTED : COLOR_ROW,
            hoverBackground: selected ? COLOR_ROW_SELECTED_HOVER : COLOR_ROW_HOVER,
        },
        onClick: interactive
            ? (_rect, info) => {
                  if (info.button === 1) {
                      const actions = itemRowMenu(t, uuid, item.name, canExport);
                      if (actions.length > 0) openMenu(info.x, info.y, actions);
                      return;
                  }
                  if (info.button !== 0) return;
                  if (canExport) toggleExportSelection({ uuid, type: t.type, name: item.name });
              }
            : undefined,
        children: [
            t.export === undefined
                ? // Browse-only type (no exporter): a plain bullet, no checkbox.
                  Text({
                      text: GLYPH_DOT,
                      color: COLOR_TEXT_DIM,
                      style: { width: { kind: "px", value: 12 } },
                  })
                : canExport
                  ? Icon({
                        name: selected ? Icons.squareCheck : Icons.square,
                        style: {
                            width: { kind: "px", value: 12 },
                            height: { kind: "px", value: 12 },
                        },
                    })
                  : Icon({
                        // Grayed checkbox: export needs the live menu, so it's
                        // disabled until you're standing in this house.
                        name: inSelection ? Icons.squareCheck : Icons.square,
                        color: COLOR_TEXT_FAINT,
                        style: {
                            width: { kind: "px", value: 12 },
                            height: { kind: "px", value: 12 },
                        },
                        tooltip: "Stand in this house to select for export",
                        tooltipColor: COLOR_TEXT_DIM,
                    }),
            ImportableIcon({
                type: item.type,
                name: item.name,
                importable: item.importable,
                functionIcon: item.icon,
                color: item.color,
            }),
            Text({
                text: item.label ?? item.name,
                color: COLOR_TEXT,
                truncate: true,
                // When a display label stands in for the identity (NPCs show
                // their name but are keyed by position), reveal the identity on
                // hover instead of the truncation preview.
                tooltip: item.label !== undefined ? item.name : undefined,
                tooltipColor: COLOR_TEXT_DIM,
                style: { width: { kind: "grow" } },
            }),
            ...(
                interactive
                    ? (t.rowActions ?? []).map((a) => itemRowActionButton(a, item.name))
                    : []
            ),
            linkStatusIcon(HOUSE_LINK_VISUAL[state].key, HOUSE_LINK_VISUAL[state].tooltip, 12),
        ],
    });
}

function namesAlreadyInDestination(
    t: HouseContentType,
    names: readonly string[]
): string[] | null {
    const sourceMap = loadedSourceImportablesByType(t.type);
    if (sourceMap === null) return null;
    const out: string[] = [];
    for (const n of names) {
        if (sourceMap.has(n)) out.push(n);
    }
    return out;
}

function confirmDestructiveExport(
    t: HouseContentType,
    names: readonly string[],
    run: () => void
): void {
    const existing = namesAlreadyInDestination(t, names);
    if (existing !== null && existing.length === 0) {
        run();
        return;
    }
    if (existing === null) {
        openConfirmPopover({
            title: "Overwrite local files?",
            lines: [
                "HTSW couldn't verify which entries already exist in the destination.",
                "Export may replace local versions with the house versions.",
            ],
            confirmLabel: "Export anyway",
            danger: true,
            onConfirm: run,
        });
        return;
    }
    const shown = existing.slice(0, 5);
    const lines = shown.map((n) => `• ${n}`);
    if (existing.length > shown.length) {
        lines.push(`…and ${existing.length - shown.length} more`);
    }
    lines.push("Export replaces the local versions with the house versions.");
    openConfirmPopover({
        title: `Overwrite existing ${t.label.toLowerCase()} (${existing.length})?`,
        lines,
        confirmLabel: "Export anyway",
        danger: true,
        onConfirm: run,
    });
}

function exportActionBar(t: HouseContentType, uuid: string, items: HouseImportable[]): Element {
    const selected = getExportSelection().filter(
        (it) => it.uuid === uuid && it.type === t.type
    );
    const selectedCount = selected.length;
    const totalCount = items.length;
    const labels = new Map<string, string>();
    for (const item of items) {
        if (item.label !== undefined) labels.set(item.name, item.label);
    }
    const deepRead = t.deepRead;
    // Missing = house items whose identity isn't already in the loaded
    // import.json. Same comparison itemRow uses.
    const exportedSet = exportedIdentities(t.type);
    const missingNames = t
        .items(uuid)
        .filter((i) => !exportedSet.has(i.name))
        .map((i) => i.name);
    const hasDest = getExportImportJsonPath().trim() !== "";
    const hasItems = totalCount > 0;
    const canExportItems = hasDest && hasItems;
    return Col({
        style: { gap: 4, padding: { side: "right", value: 8 } },
        children: [
            Button({
                style: {
                    direction: "row",
                    justify: "start",
                    gap: 6,
                    padding: { side: "x", value: 8 },
                    height: { kind: "px", value: 34 },
                    align: "center",
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                tooltip: hasDest ? "Change export destination" : "Choose an export destination",
                tooltipColor: COLOR_TEXT_DIM,
                onClick: (rect: Rect) =>
                    togglePopover({
                        key: "houses-export-destination",
                        anchor: rect,
                        content: exportDestinationPicker(),
                        width: 380,
                        height: 320,
                    }),
                children: [
                    Icon({
                        name: hasDest ? Icons.folderOutput : Icons.folderPlus,
                        color: hasDest ? undefined : COLOR_TEXT_DIM,
                    }),
                    Col({
                        style: { gap: 2, width: { kind: "grow" } },
                        children: [
                            Text({
                                text: () => {
                                    const destination = getExportImportJsonPath();
                                    if (destination.trim() === "") return "Choose where to export";
                                    const project = basename(dirname(destination));
                                    return `Project: ${project}`;
                                },
                                color: hasDest ? COLOR_TEXT : COLOR_TEXT_DIM,
                                truncate: true,
                            }),
                            Text({
                                text: () => {
                                    if (getExportImportJsonPath().trim() === "") {
                                        return "Select a project and folder";
                                    }
                                    return `New exports: ${shortPath(getEffectiveNewExportTarget())}`;
                                },
                                color: COLOR_TEXT_DIM,
                                truncate: true,
                            }),
                        ],
                    }),
                    Icon({ name: Icons.chevronRight, color: COLOR_TEXT_DIM }),
                ],
            }),
            Row({
                style: { gap: 4, height: { kind: "px", value: 20 } },
                children: [
                    Button({
                        children: [
                            Icon({
                                name: Icons.fileUp,
                                color: canExportItems ? undefined : COLOR_TEXT_FAINT,
                            }),
                            Text({
                                text:
                                    selectedCount > 0
                                        ? `Export Selected (${selectedCount})`
                                        : `Export All (${totalCount})`,
                                color: canExportItems ? undefined : COLOR_TEXT_FAINT,
                            }),
                        ],
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: canExportItems ? COLOR_BUTTON_PRIMARY : COLOR_BUTTON,
                            hoverBackground: canExportItems
                                ? COLOR_BUTTON_PRIMARY_HOVER
                                : COLOR_BUTTON,
                        },
                        tooltip: !hasDest
                            ? "Choose a destination first"
                            : !hasItems
                              ? `No ${t.label.toLowerCase()} in this house`
                              : undefined,
                        tooltipColor: COLOR_TEXT_FAINT,
                        disabled: !canExportItems,
                        onClick: () => {
                            if (!canExportItems) return;
                            if (t.export === undefined) return;
                            const exp = t.export;
                            if (selectedCount > 0) {
                                const names = selected.map((it) => it.name);
                                confirmDestructiveExport(t, names, () =>
                                    exp.selected(names, () => clearExportSelection(), labels)
                                );
                            } else {
                                const names = items.map((i) => i.name);
                                confirmDestructiveExport(t, names, () => exp.all(labels));
                            }
                        },
                    }),
                    deepRead !== undefined &&
                        selectedCount > 0 &&
                        Button({
                            children: [
                                Icon({ name: Icons.scanEye }),
                                Text({ text: `Read (${selectedCount})` }),
                            ],
                            style: {
                                height: { kind: "grow" },
                                background: COLOR_BUTTON,
                                hoverBackground: COLOR_BUTTON_HOVER,
                            },
                            tooltip: "Read selected into knowledge",
                            tooltipColor: COLOR_TEXT_DIM,
                            onClick: () =>
                                deepRead(selected.map((it) => it.name)),
                        }),
                    Button({
                        // Explicit 12px icon via children: the `icon:` shorthand
                        // defaults to 16px, which overflows a ~22px button (inner
                        // ~14px after padding) and reads as cut off / off-center.
                        children: [
                            Icon({
                                name: Icons.chevronUp,
                                color: canExportItems ? undefined : COLOR_TEXT_FAINT,
                                style: {
                                    width: { kind: "px", value: 12 },
                                    height: { kind: "px", value: 12 },
                                },
                            }),
                        ],
                        style: {
                            width: { kind: "px", value: 22 },
                            height: { kind: "grow" },
                            background: canExportItems ? COLOR_BUTTON_PRIMARY : COLOR_BUTTON,
                            hoverBackground: canExportItems
                                ? COLOR_BUTTON_PRIMARY_HOVER
                                : COLOR_BUTTON,
                        },
                        tooltip: !hasDest
                            ? "Choose a destination first"
                            : !hasItems
                              ? `No ${t.label.toLowerCase()} in this house`
                              : undefined,
                        tooltipColor: COLOR_TEXT_FAINT,
                        disabled: !canExportItems,
                        // Anchor to the caret's rect (not the cursor) so the menu
                        // right-aligns under the button and drops up consistently.
                        onClick: (rect: Rect) => {
                            if (!canExportItems) return;
                            if (t.export === undefined) return;
                            const exp = t.export;
                            // The yellow "differs" rows: in your file but the
                            // house version has diverged. Computed exactly as the
                            // rows render their status so the count matches what
                            // you see. Export pulls the house version over local,
                            // so it always routes through the overwrite confirm.
                            const trusted = isHouseTrusted(uuid);
                            const sourceMap = sourceImportablesByType(t.type);
                            const unreadNames: string[] = [];
                            const differingNames: string[] = [];
                            for (const i of t.items(uuid)) {
                                const state = houseLinkStateFor(uuid, i, sourceMap, trusted);
                                if (state === "unread") unreadNames.push(i.name);
                                if (state === "differs-from-knowledge") differingNames.push(i.name);
                            }
                            const actions: MenuAction[] = [
                                {
                                    // Missing names aren't in your file, so
                                    // they are not compared against Knowledge — no confirm.
                                    label: `Export missing (${missingNames.length})`,
                                    disabled: missingNames.length === 0,
                                    onClick: () => {
                                        if (missingNames.length > 0) {
                                            exp.selected(missingNames, () =>
                                                clearExportSelection()
                                            );
                                        }
                                    },
                                },
                                {
                                    label: `Export unread (${unreadNames.length})`,
                                    disabled: unreadNames.length === 0,
                                    onClick: () => {
                                        if (unreadNames.length > 0) {
                                            confirmDestructiveExport(t, unreadNames, () =>
                                                exp.selected(unreadNames, () =>
                                                    clearExportSelection()
                                                )
                                            );
                                        }
                                    },
                                },
                                {
                                    label: `Export differing (${differingNames.length})`,
                                    disabled: differingNames.length === 0,
                                    onClick: () => {
                                        if (differingNames.length > 0) {
                                            confirmDestructiveExport(t, differingNames, () =>
                                                exp.selected(differingNames, () =>
                                                    clearExportSelection()
                                                )
                                            );
                                        }
                                    },
                                },
                                {
                                    label: `Export all (${totalCount})`,
                                    disabled: totalCount === 0,
                                    onClick: () => {
                                        if (totalCount === 0) return;
                                        const names = t.items(uuid).map((i) => i.name);
                                        confirmDestructiveExport(t, names, () => exp.all());
                                    },
                                },
                            ];
                            if (deepRead !== undefined) {
                                actions.push({ kind: "separator" });
                                actions.push({
                                    label: `Read all into knowledge (${totalCount})`,
                                    icon: Icons.scanEye,
                                    disabled: totalCount === 0,
                                    onClick: () => {
                                        if (totalCount > 0) deepRead();
                                    },
                                });
                            }
                            openMenu(rect.x + rect.w, rect.y, actions, {
                                key: "houses-export-menu",
                                trigger: rect,
                            });
                        },
                    }),
                    selectedCount > 0 &&
                        Button({
                            children: [
                                Icon({
                                    name: Icons.x,
                                    style: {
                                        width: { kind: "px", value: 12 },
                                        height: { kind: "px", value: 12 },
                                    },
                                }),
                            ],
                            style: {
                                width: { kind: "px", value: 22 },
                                height: { kind: "grow" },
                                background: COLOR_BUTTON,
                                hoverBackground: COLOR_BUTTON_HOVER,
                            },
                            onClick: () => clearExportSelection(),
                        }),
                ],
            }),
        ],
    });
}

export function typeBrowserSection(getViewedUuid: () => string | null, availW: number): Element {
    return Col({
        style: { gap: 4, height: { kind: "grow" } },
        children: () => {
            const t = activeType();
            const uuid = getViewedUuid();
            const inCurrentHouse = uuid !== null && uuid === getHousingUuid();
            const canScan = inCurrentHouse && t.scanNames !== false;
            const canExport = t.export !== undefined && inCurrentHouse;
            const tabCount = HOUSE_CONTENT_TYPES.length;
            const perTab = (availW - TAB_GAP * (tabCount - 1)) / tabCount;
            const showLabels = tabLabelsFit(
                perTab,
                HOUSE_CONTENT_TYPES.map((type) => type.label)
            );
            const tabStrip = HOUSE_CONTENT_TYPES.map((type) =>
                typeTabButton(type, showLabels)
            );
            const out: Element[] = [
                Row({
                    style: { gap: TAB_GAP, height: { kind: "px", value: 18 } },
                    children: tabStrip,
                }),
            ];
            if (uuid === null) {
                out.push(
                    Text({
                        text: "No house selected — click Detect above.",
                        color: COLOR_TEXT_FAINT,
                    })
                );
                return out;
            }
            const scanned = t.scanned(uuid);
            const items = scanned ? t.items(uuid) : [];
            // Keep the search bar (with the rescan button) present whenever you
            // can scan or there's something to search, so the button doesn't
            // vanish in the not-scanned / empty states.
            if (canScan || items.length > 0) {
                out.push(searchRow(t, uuid, canScan));
            }
            if (!scanned) {
                out.push(
                    Text({
                        text: () => {
                            if (!canScan) {
                                return `Stand in this house and Scan to list its ${t.label.toLowerCase()}.`;
                            }
                            return t.scanInFlight()
                                ? "Scanning…"
                                : `Click Scan to list this house's ${t.label.toLowerCase()}.`;
                        },
                        color: COLOR_TEXT_FAINT,
                    })
                );
                return out;
            }
            if (items.length === 0) {
                out.push(
                    Col({
                        style: { height: { kind: "grow" } },
                        children: [
                            Text({
                                text: `No ${t.label.toLowerCase()} in this house.`,
                                color: COLOR_TEXT_FAINT,
                            }),
                        ],
                    })
                );
            } else {
                const query = itemSearch.trim().toLowerCase();
                const sourceMap = sourceImportablesByType(t.type);
                const trusted = isHouseTrusted(uuid);
                const statusActive = selectedHouseStatuses.size > 0;
                const shown: { item: HouseImportable; state: HouseLinkState }[] = [];
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (
                        query !== "" &&
                        (item.label ?? item.name).toLowerCase().indexOf(query) === -1 &&
                        item.name.toLowerCase().indexOf(query) === -1
                    ) {
                        continue;
                    }
                    const state = houseLinkStateFor(uuid, item, sourceMap, trusted);
                    if (statusActive && !selectedHouseStatuses.has(HOUSE_LINK_VISUAL[state].key)) {
                        continue;
                    }
                    shown.push({ item, state });
                }
                shown.sort(compareHouseRows);
                if (shown.length === 0) {
                    const noun = t.label.toLowerCase();
                    const message =
                        query !== ""
                            ? `No ${noun} match "${itemSearch.trim()}".`
                            : `No ${noun} match the status filter.`;
                    out.push(
                        Col({
                            style: { height: { kind: "grow" } },
                            children: [Text({ text: message, color: COLOR_TEXT_FAINT })],
                        })
                    );
                } else {
                    out.push(
                        Scroll({
                            id: "houses-type-scroll",
                            style: { height: { kind: "grow" }, gap: 1 },
                            children: shown.map((s) =>
                                itemRow(t, uuid, s.item, inCurrentHouse, canExport, s.state)
                            )
                        })
                    );
                }
            }
            if (canExport) {
                out.push(exportActionBar(t, uuid, items));
            } else if (t.export !== undefined) {
                out.push(
                    Row({
                        style: {
                            gap: 6,
                            align: "center",
                            padding: { side: "x", value: 4 },
                            height: { kind: "px", value: SIZE_ROW_H },
                        },
                        children: [
                            Icon({
                                name: Icons.house,
                                color: COLOR_TEXT_FAINT,
                                style: {
                                    width: { kind: "px", value: 12 },
                                    height: { kind: "px", value: 12 },
                                },
                            }),
                            Text({
                                text: `Stand in this house to export its ${t.label.toLowerCase()}.`,
                                color: COLOR_TEXT_FAINT,
                                style: { width: { kind: "grow" } },
                            }),
                        ],
                    })
                );
            }
            return out;
        },
    });
}
