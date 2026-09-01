/// <reference types="../../../../CTAutocomplete" />

import { Element, Rect } from "../../lib/layout";
import {
    Button,
    Col,
    Container,
    Icon,
    Input,
    Row,
    Scroll,
    Text,
} from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import type { IconName } from "../../lib/icons.generated";
import { getExportImportJsonPath, getHousingUuid, isHouseTrusted } from "../../state";
import { requestParse } from "../../parsing/parses";
import { openConfirmPopover } from "../../popovers/confirm";
import { openMenu, type MenuAction } from "../../lib/menu";
import { togglePopover } from "../../lib/popovers";
import { getExportDestinationStatus } from "../../export/destinationStatus";
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
    statusFilterPopoverHeight,
    statusFilterPopoverWidth,
    FILTER_ACTIVE_BG,
    FILTER_ACTIVE_HOVER_BG,
    type LinkStatusOption,
} from "../statusFilter";
import type { Importable } from "htsw/types";
import { TAB_GAP, tabLabelsFit } from "../tabs";
import { ImportableIcon } from "../../importableVisuals";
import { startChestExport } from "../../export/chestExport";
import { markGuiDirty } from "../../lib/dirty";
import { getUnmatchedFunctionsFirst } from "../../../settings";
import type { HouseReadableType } from "../../../importables/export/readers";
import { showToast } from "../../toast";
import {
    enqueueHouseBulk,
    enqueueHouseConcrete,
    enqueueWholeHouse,
    type HouseQueueTarget,
} from "./queueActions";
import {
    buildHouseQueueMenu,
    declaredOverwriteNames,
    queueNamesForRow,
    type HouseQueueCounts,
    type HouseQueueMenuActionId,
} from "./queueMenu";
import { buildOverwriteConfirmation } from "./overwriteConfirmation";
import { TaskManager } from "../../../tasks/manager";

let activeContentType: HouseContentType["type"] = HOUSE_CONTENT_TYPES[0].type;
let itemSearch = "";
const SEARCH_ROW_H = SIZE_ROW_H + 6;

const HOUSE_LINK_STATUSES: LinkStatusOption[] = [
    { key: "matches", label: "Matches project" },
    { key: "differs", label: "Differs from project" },
    { key: "present", label: "In project, not read" },
    { key: "oneSided", label: "Not in project" },
    { key: "unknown", label: "Unknown" },
];

const selectedHouseStatuses: Set<LinkStatusKey> = new Set();

function toggleHouseStatus(key: LinkStatusKey): void {
    if (selectedHouseStatuses.has(key)) selectedHouseStatuses.delete(key);
    else selectedHouseStatuses.add(key);
}

type HouseSortId = "alphabetical" | "status";
type HouseSortDir = "ASC" | "DESC";
type HouseSort = { id: HouseSortId; direction: HouseSortDir };
const HOUSE_SORT_FIELDS: { id: HouseSortId; label: string }[] = [
    { id: "alphabetical", label: "Alphabetically" },
    { id: "status", label: "By import/export status" },
];
// Actionable-first when sorting by status: rows that differ from your files
// come before matches and the rest.
const STATUS_SORT_ORDER: LinkStatusKey[] = [
    "differs",
    "matches",
    "present",
    "oneSided",
    "unknown",
];
const DEFAULT_HOUSE_SORT: HouseSort = {
    id: "alphabetical",
    direction: "ASC",
};
let houseSort: HouseSort = {
    id: "alphabetical",
    direction: "ASC",
};

function isHouseSortDefault(): boolean {
    return (
        houseSort.id === DEFAULT_HOUSE_SORT.id &&
        houseSort.direction === DEFAULT_HOUSE_SORT.direction
    );
}

function selectHouseSort(id: HouseSortId): void {
    if (houseSort.id === id) {
        houseSort.direction = houseSort.direction === "ASC" ? "DESC" : "ASC";
    } else {
        houseSort = { id, direction: "ASC" };
    }
}

export function compareHouseRows(
    a: { item: HouseImportable; state: HouseLinkState },
    b: { item: HouseImportable; state: HouseLinkState },
    unmatchedFunctionsFirst = false,
    sort: HouseSort = houseSort
): number {
    if (unmatchedFunctionsFirst && a.state !== b.state) {
        if (a.state === "house-only") return -1;
        if (b.state === "house-only") return 1;
    }
    const an = (a.item.label ?? a.item.name).toLowerCase();
    const bn = (b.item.label ?? b.item.name).toLowerCase();
    const alpha = an < bn ? -1 : an > bn ? 1 : 0;
    let c = alpha;
    if (sort.id === "status") {
        c =
            STATUS_SORT_ORDER.indexOf(HOUSE_LINK_VISUAL[a.state].key) -
            STATUS_SORT_ORDER.indexOf(HOUSE_LINK_VISUAL[b.state].key);
        if (c === 0) c = alpha;
    }
    return sort.direction === "ASC" ? c : -c;
}

function activeType(): HouseContentType {
    for (let i = 0; i < HOUSE_CONTENT_TYPES.length; i++) {
        if (HOUSE_CONTENT_TYPES[i].type === activeContentType)
            return HOUSE_CONTENT_TYPES[i];
    }
    return HOUSE_CONTENT_TYPES[0];
}

function typeTabButton(t: HouseContentType, showLabel: boolean): Element {
    const isActive = activeContentType === t.type;
    const children: Element[] = [
        Icon({
            name: t.icon,
        }),
    ];
    if (showLabel) {
        children.push(
            Text({ text: t.label, truncate: true, style: { width: { kind: "grow" } } })
        );
    }
    return Button({
        children,
        tooltip: showLabel ? undefined : t.label,
        tooltipColor: COLOR_TEXT,
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

// The sort/filter buttons mirror the Projects bar: no background until active
// (then the same green tint).
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
            width: { kind: "px", value: SEARCH_ROW_H },
            height: { kind: "grow" },
            background: () => (isActive() ? FILTER_ACTIVE_BG : undefined),
            hoverBackground: () => (isActive() ? FILTER_ACTIVE_HOVER_BG : undefined),
        },
        tooltip,
        tooltipColor: COLOR_TEXT_DIM,
        onClick: (rect) => onClick(rect),
        children: [
            Icon({
                name: iconName,
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                },
            }),
        ],
    });
}

function houseSortButton(): Element {
    return barControlButton(
        Icons.arrowUpDown,
        () => !isHouseSortDefault(),
        "Sort",
        (rect) => {
            togglePopover({
                key: "houses-sort",
                anchor: rect,
                content: houseSortPopoverContent(),
                width: 190,
                height: HOUSE_SORT_FIELDS.length * 20 + 6,
            });
        }
    );
}

function houseStatusFilterButton(): Element {
    return barControlButton(
        Icons.filter,
        () => selectedHouseStatuses.size > 0,
        "Filter by status",
        (rect) => {
            togglePopover({
                key: "houses-status-filter",
                anchor: rect,
                content: statusFilterPopoverContent(
                    HOUSE_LINK_STATUSES,
                    selectedHouseStatuses,
                    toggleHouseStatus
                ),
                width: statusFilterPopoverWidth(HOUSE_LINK_STATUSES),
                height: statusFilterPopoverHeight(HOUSE_LINK_STATUSES),
            });
        }
    );
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

function searchRow(t: HouseContentType): Element {
    const children: Element[] = [
        Input({
            id: "houses-item-search",
            value: () => itemSearch,
            onChange: (v) => {
                itemSearch = v;
                markGuiDirty();
            },
            placeholder: `Search ${t.label.toLowerCase()}…`,
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: SEARCH_ROW_H },
            },
        }),
    ];
    children.push(houseSortButton());
    children.push(houseStatusFilterButton());
    return Row({
        style: { gap: 4, height: { kind: "px", value: SEARCH_ROW_H } },
        children,
    });
}

// The source file (htsl/.snbt/json) for an importable in the selected
// import.json, or null if it isn't in your file. Called on right-click, not per
// frame, so re-resolving through the (cached) parse is fine.
function sourcePathForImportable(
    type: HouseContentType["type"],
    name: string
): string | null {
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

type QueueableHouseContentType = HouseContentType & {
    type: HouseReadableType;
    queueLabel: string;
};

function isQueueableType(t: HouseContentType): t is QueueableHouseContentType {
    return t.queueLabel !== undefined;
}

function selectionFor(uuid: string, type: HouseContentType["type"]): string[] {
    return getExportSelection()
        .filter((item) => item.uuid === uuid && item.type === type)
        .map((item) => item.name);
}

function targetsForNames(
    names: readonly string[],
    items: readonly HouseImportable[]
): HouseQueueTarget[] {
    const labels = new Map<string, string>();
    for (const item of items) labels.set(item.name, item.label ?? item.name);
    return names.map((identity) => ({
        identity,
        label: labels.get(identity) ?? identity,
    }));
}

function queueConcrete(
    t: QueueableHouseContentType,
    uuid: string,
    path: string,
    items: readonly HouseImportable[],
    names: readonly string[],
    op: "read" | "export",
    clearSelection: boolean
): void {
    enqueueHouseConcrete({
        op,
        house: uuid,
        path,
        type: t.type,
        singularLabel: t.queueLabel,
        targets: targetsForNames(names, items),
        onAdded: clearSelection ? () => clearExportSelection(uuid, t.type) : undefined,
    });
}

function runImmediateHousingAction(run: () => void): void {
    if (TaskManager.isBusy()) {
        showToast(
            "A queued Housing operation is running — wait for it to finish",
            0xffe5bc4b
        );
        return;
    }
    run();
}

function itemRowMenu(
    t: QueueableHouseContentType,
    uuid: string,
    item: HouseImportable,
    items: readonly HouseImportable[],
    inCurrentHouse: boolean
): MenuAction[] {
    const actions: MenuAction[] = [];
    const selectedNames = selectionFor(uuid, t.type);
    const queuedNames = queueNamesForRow(selectedNames, item.name);
    const clearSelection = selectedNames.length > 0;
    const destination = getExportDestinationStatus();
    const destinationPath = destination.kind === "ready" ? destination.path : null;
    actions.push({
        label: "Queue export",
        icon: Icons.fileUp,
        disabled: destinationPath === null,
        onClick: () => {
            confirmDestructiveExport(
                t.label.toLowerCase(),
                namesAlreadyInDestination(t, queuedNames),
                () => {
                    if (destinationPath === null) return;
                    queueConcrete(
                        t,
                        uuid,
                        destinationPath,
                        items,
                        queuedNames,
                        "export",
                        clearSelection
                    );
                }
            );
        },
    });
    actions.push({
        label: "Queue read",
        icon: Icons.scanEye,
        disabled: destinationPath === null,
        onClick: () => {
            if (destinationPath === null) return;
            queueConcrete(
                t,
                uuid,
                destinationPath,
                items,
                queuedNames,
                "read",
                clearSelection
            );
        },
    });
    actions.push({ kind: "separator" });
    // Reuse the existing View-tab diff (source vs cached house content) rather
    // than building a diff here — only when the importable is in your file.
    const sourcePath = sourcePathForImportable(t.type, item.name);
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
        actions.push({
            label: a.label,
            icon: a.icon,
            disabled: !inCurrentHouse,
            onClick: () => runImmediateHousingAction(() => a.run(item.name)),
        });
    }
    if (t.remove !== undefined) {
        actions.push({ kind: "separator" });
        actions.push({
            label: "Delete",
            icon: Icons.trash2,
            disabled: !inCurrentHouse,
            onClick: () => runImmediateHousingAction(() => t.remove?.(item.name)),
        });
    }
    return actions;
}

type HouseLinkState =
    | "house-only"
    | "exists-in-house"
    | "unread"
    | "matches-knowledge"
    | "differs-from-knowledge"
    | "unknown";

type HouseRow = { item: HouseImportable; state: HouseLinkState };

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
    unknown: { key: "unknown", tooltip: "Waiting for the project to load" },
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

function houseLinkStateFor(
    uuid: string | null,
    item: HouseImportable,
    sourceByKey: Map<string, Importable> | null,
    trusted: boolean
): HouseLinkState {
    if (sourceByKey === null) return "unknown";
    const source = sourceByKey.get(item.name);
    if (source === undefined) return "house-only";
    if (!trusted) return "exists-in-house";
    if (uuid === null || !item.verified) return "unread";
    const state = buildCacheStatusRow(uuid, source).state;
    if (state === "current") return "matches-knowledge";
    if (state === "modified") return "differs-from-knowledge";
    return "unread";
}

function houseRowsFor(
    t: QueueableHouseContentType,
    uuid: string,
    items: readonly HouseImportable[]
): HouseRow[] {
    const sourceMap = loadedSourceImportablesByType(t.type);
    const trusted = isHouseTrusted(uuid);
    return items.map((item) => ({
        item,
        state: houseLinkStateFor(uuid, item, sourceMap, trusted),
    }));
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
            runImmediateHousingAction(() => action.run(name));
        },
        tooltip: action.label,
        tooltipColor: COLOR_TEXT_DIM,
        children: [
            Icon({
                name: action.icon,
                color: COLOR_TEXT_DIM,
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                },
            }),
        ],
    });
}

function itemRowMenuButton(
    t: QueueableHouseContentType,
    uuid: string,
    item: HouseImportable,
    items: readonly HouseImportable[],
    inCurrentHouse: boolean
): Element {
    return Button({
        style: {
            width: { kind: "px", value: 16 },
            height: { kind: "grow" },
            padding: 0,
            background: 0x00000000,
            hoverBackground: COLOR_BUTTON_HOVER,
        },
        tooltip: "More actions",
        tooltipColor: COLOR_TEXT_DIM,
        onClick: (rect, info) => {
            if (info.button !== 0 || info.isDoubleClickSecond) return;
            openMenu(
                rect.x + rect.w,
                rect.y,
                itemRowMenu(t, uuid, item, items, inCurrentHouse),
                { key: `house-row:${uuid}:${t.type}:${item.name}`, trigger: rect }
            );
        },
        children: [
            Icon({
                name: Icons.ellipsisVertical,
                color: COLOR_TEXT_FAINT,
                style: {
                    width: { kind: "px", value: 11 },
                    height: { kind: "px", value: 11 },
                },
            }),
        ],
    });
}

function itemRow(
    t: QueueableHouseContentType,
    uuid: string,
    item: HouseImportable,
    items: readonly HouseImportable[],
    inCurrentHouse: boolean,
    state: HouseLinkState
): Element {
    const inSelection = isInExportSelection(uuid, t.type, item.name);
    const selected = inSelection;
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
        onClick: (_rect, info) => {
            if (info.isDoubleClickSecond) return;
            if (info.button === 1) {
                openMenu(
                    info.x,
                    info.y,
                    itemRowMenu(t, uuid, item, items, inCurrentHouse)
                );
                return;
            }
            if (info.button !== 0) return;
            toggleExportSelection({ uuid, type: t.type, name: item.name });
        },
        children: [
            Icon({
                name: selected ? Icons.squareCheck : Icons.square,
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                },
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
            ...(inCurrentHouse
                ? (t.rowActions ?? []).map((a) => itemRowActionButton(a, item.name))
                : []),
            linkStatusIcon(
                HOUSE_LINK_VISUAL[state].key,
                HOUSE_LINK_VISUAL[state].tooltip,
                12
            ),
            itemRowMenuButton(t, uuid, item, items, inCurrentHouse),
        ],
    });
}

function namesAlreadyInDestination(
    t: HouseContentType,
    names: readonly string[]
): string[] | null {
    const sourceMap = loadedSourceImportablesByType(t.type);
    return declaredOverwriteNames(
        names,
        sourceMap === null ? null : new Set(sourceMap.keys())
    );
}

function confirmDestructiveExport(
    noun: string,
    existingNames: readonly string[] | null,
    runOverwrite: () => void
): void {
    const confirmation = buildOverwriteConfirmation(noun, existingNames);
    if (confirmation === null) {
        runOverwrite();
        return;
    }
    openConfirmPopover({
        title: confirmation.title,
        lines: confirmation.lines,
        confirmLabel: "Export anyway",
        danger: true,
        onConfirm: runOverwrite,
    });
}

function queueableTypes(): QueueableHouseContentType[] {
    return HOUSE_CONTENT_TYPES.filter(isQueueableType);
}

function wholeHouseOverwriteNames(uuid: string): string[] | null {
    const existing: string[] = [];
    for (const type of queueableTypes()) {
        const source = loadedSourceImportablesByType(type.type);
        if (source === null) return null;
        for (const item of type.items(uuid)) {
            if (source.has(item.name)) {
                existing.push(`${type.label}: ${item.label ?? item.name}`);
            }
        }
    }
    return existing;
}

function queueBulk(
    t: QueueableHouseContentType,
    uuid: string,
    path: string,
    op: "read" | "export",
    filter: "all" | "new" | "changed",
    label: string
): void {
    enqueueHouseBulk({ op, house: uuid, path, type: t.type, filter, label });
}

function runQueueMenuAction(
    id: HouseQueueMenuActionId,
    t: QueueableHouseContentType,
    uuid: string,
    path: string,
    items: readonly HouseImportable[],
    allRows: readonly HouseRow[],
    shownRows: readonly HouseRow[]
): void {
    const noun = t.label.toLowerCase();
    const shownNames = shownRows.map((row) => row.item.name);
    const changedNames = allRows
        .filter((row) => row.state === "differs-from-knowledge")
        .map((row) => row.item.name);
    switch (id) {
        case "read-all":
            queueBulk(t, uuid, path, "read", "all", `Read all ${noun}`);
            return;
        case "read-changed":
            queueBulk(t, uuid, path, "read", "changed", `Read changed ${noun}`);
            return;
        case "read-shown":
            queueConcrete(t, uuid, path, items, shownNames, "read", false);
            return;
        case "export-all":
            confirmDestructiveExport(
                noun,
                namesAlreadyInDestination(
                    t,
                    allRows.map((row) => row.item.name)
                ),
                () => queueBulk(t, uuid, path, "export", "all", `Export all ${noun}`)
            );
            return;
        case "export-new":
            queueBulk(t, uuid, path, "export", "new", `Export new ${noun}`);
            return;
        case "export-changed":
            confirmDestructiveExport(
                noun,
                namesAlreadyInDestination(t, changedNames),
                () =>
                    queueBulk(
                        t,
                        uuid,
                        path,
                        "export",
                        "changed",
                        `Export changed ${noun}`
                    )
            );
            return;
        case "export-shown":
            confirmDestructiveExport(noun, namesAlreadyInDestination(t, shownNames), () =>
                queueConcrete(t, uuid, path, items, shownNames, "export", false)
            );
            return;
        case "export-house": {
            confirmDestructiveExport(
                "local entries",
                wholeHouseOverwriteNames(uuid),
                () =>
                    enqueueWholeHouse({
                        house: uuid,
                        path,
                        types: queueableTypes().map((type) => ({
                            type: type.type,
                            pluralLabel: type.label,
                        })),
                    })
            );
        }
    }
}

function queueAllMenuActions(
    t: QueueableHouseContentType,
    uuid: string,
    destinationPath: string | null,
    items: readonly HouseImportable[],
    allRows: readonly HouseRow[],
    shownRows: readonly HouseRow[],
    counts: HouseQueueCounts,
    destinationReady: boolean
): MenuAction[] {
    return buildHouseQueueMenu(t.label, counts, destinationReady).map((entry) =>
        entry.kind === "separator"
            ? { kind: "separator" }
            : {
                  label: entry.label,
                  disabled: entry.disabled || destinationPath === null,
                  onClick: () =>
                      destinationPath !== null &&
                      runQueueMenuAction(
                          entry.id,
                          t,
                          uuid,
                          destinationPath,
                          items,
                          allRows,
                          shownRows
                      ),
              }
    );
}

function queueActionBar(
    t: QueueableHouseContentType,
    uuid: string,
    items: HouseImportable[],
    allRows: HouseRow[],
    shownRows: HouseRow[],
    inCurrentHouse: boolean
): Element {
    const selectedNames = selectionFor(uuid, t.type);
    const selectedCount = selectedNames.length;
    const destination = getExportDestinationStatus();
    const destinationReady = destination.kind === "ready";
    const destinationPath = destination.kind === "ready" ? destination.path : null;
    const counts: HouseQueueCounts = {
        all: t.scanned(uuid) ? allRows.length : null,
        changed: allRows.filter((row) => row.state === "differs-from-knowledge").length,
        shown: shownRows.length,
        new: allRows.filter((row) => row.state === "house-only").length,
    };
    const destinationTooltip =
        destination.kind === "missing"
            ? "The selected export project is missing"
            : destination.kind === "none"
              ? "Choose an export project first"
              : undefined;
    const barChildren: Element[] = [];
    if (selectedCount > 0) {
        barChildren.push(
            Button({
                icon: Icons.x,
                text: String(selectedCount),
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                tooltip: "Clear selection",
                tooltipColor: COLOR_TEXT_DIM,
                onClick: () => clearExportSelection(uuid, t.type),
            })
        );
        barChildren.push(
            Button({
                icon: Icons.scanEye,
                text: "Read",
                disabled: !destinationReady,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: destinationReady ? COLOR_BUTTON_HOVER : COLOR_BUTTON,
                },
                tooltip: destinationTooltip ?? "Queue the selected entries to read",
                tooltipColor: destinationReady ? COLOR_TEXT_DIM : COLOR_TEXT_FAINT,
                onClick: () => {
                    if (destinationPath === null) return;
                    queueConcrete(
                        t,
                        uuid,
                        destinationPath,
                        items,
                        selectedNames,
                        "read",
                        true
                    );
                },
            })
        );
        barChildren.push(
            Button({
                icon: Icons.fileUp,
                text: "Export",
                disabled: !destinationReady,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: destinationReady ? COLOR_BUTTON_PRIMARY : COLOR_BUTTON,
                    hoverBackground: destinationReady
                        ? COLOR_BUTTON_PRIMARY_HOVER
                        : COLOR_BUTTON,
                },
                tooltip: destinationTooltip ?? "Queue the selected entries to export",
                tooltipColor: destinationReady ? COLOR_TEXT_DIM : COLOR_TEXT_FAINT,
                onClick: () =>
                    confirmDestructiveExport(
                        t.label.toLowerCase(),
                        namesAlreadyInDestination(t, selectedNames),
                        () => {
                            if (destinationPath === null) return;
                            queueConcrete(
                                t,
                                uuid,
                                destinationPath,
                                items,
                                selectedNames,
                                "export",
                                true
                            );
                        }
                    ),
            })
        );
    } else {
        if (inCurrentHouse && t.scanNames !== false) {
            barChildren.push(
                Button({
                    icon: Icons.scanText,
                    text: () => (t.scanInFlight() ? "Scanning…" : "Scan"),
                    disabled: () => t.scanInFlight(),
                    style: {
                        width: { kind: "grow" },
                        height: { kind: "grow" },
                        background: COLOR_BUTTON,
                        hoverBackground: COLOR_BUTTON_HOVER,
                    },
                    tooltip: "Refresh the names listed for this house",
                    tooltipColor: COLOR_TEXT_DIM,
                    onClick: () => {
                        if (!t.scanInFlight()) t.scan();
                    },
                })
            );
        }
        barChildren.push(
            Button({
                children: [
                    Text({
                        text: "Queue all…",
                        truncate: true,
                        style: { width: { kind: "grow" } },
                    }),
                    Icon({ name: Icons.chevronDown }),
                ],
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                tooltip: destinationTooltip,
                tooltipColor: COLOR_TEXT_FAINT,
                onClick: (rect) =>
                    openMenu(
                        rect.x + rect.w,
                        rect.y,
                        queueAllMenuActions(
                            t,
                            uuid,
                            destinationPath,
                            items,
                            allRows,
                            shownRows,
                            counts,
                            destinationReady
                        ),
                        { key: `house-queue-all:${uuid}:${t.type}`, trigger: rect }
                    ),
            })
        );
    }
    const children: Element[] = [
        Row({
            style: { gap: 4, height: { kind: "px", value: 20 } },
            children: barChildren,
        }),
    ];
    if (t.type === "MENU" && inCurrentHouse) {
        children.push(
            Row({
                style: { height: { kind: "px", value: 20 } },
                children: [
                    Button({
                        icon: Icons.packageOpen,
                        text: "Export open chest…",
                        disabled: !destinationReady,
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: destinationReady
                                ? COLOR_BUTTON_HOVER
                                : COLOR_BUTTON,
                        },
                        tooltip: destinationTooltip,
                        tooltipColor: COLOR_TEXT_FAINT,
                        onClick: () => startChestExport(),
                    }),
                ],
            })
        );
    }
    return Col({
        style: { gap: 4, padding: { side: "right", value: 8 } },
        children,
    });
}

export function typeBrowserSection(
    getViewedUuid: () => string | null,
    availW: number
): Element {
    return Col({
        style: { gap: 4, height: { kind: "grow" } },
        children: () => {
            const t = activeType();
            const uuid = getViewedUuid();
            const inCurrentHouse = uuid !== null && uuid === getHousingUuid();
            const canScan = inCurrentHouse && t.scanNames !== false;
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
            if (t.standaloneAction !== undefined) {
                out.push(
                    Button({
                        children: [
                            Icon({ name: Icons.fileUp }),
                            Text({ text: t.standaloneAction.label }),
                        ],
                        style: {
                            height: { kind: "px", value: 20 },
                            background: COLOR_BUTTON_PRIMARY,
                            hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                        },
                        onClick: t.standaloneAction.run,
                    })
                );
                return out;
            }
            if (!isQueueableType(t)) return out;
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
            const cachedItems = t.items(uuid);
            const items = scanned ? cachedItems : [];
            const allRows = houseRowsFor(t, uuid, cachedItems);
            const shown: HouseRow[] = [];
            // Keep search and filtering available before the first scan and in
            // empty states; Scan itself stays in the bottom action row.
            if (canScan || items.length > 0) {
                out.push(searchRow(t));
            }
            if (!scanned) {
                out.push(
                    Col({
                        style: { height: { kind: "grow" } },
                        children: [
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
                            }),
                        ],
                    })
                );
                out.push(
                    queueActionBar(t, uuid, cachedItems, allRows, shown, inCurrentHouse)
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
                const statusActive = selectedHouseStatuses.size > 0;
                for (let i = 0; i < allRows.length; i++) {
                    const row = allRows[i];
                    const item = row.item;
                    if (
                        query !== "" &&
                        (item.label ?? item.name).toLowerCase().indexOf(query) === -1 &&
                        item.name.toLowerCase().indexOf(query) === -1
                    ) {
                        continue;
                    }
                    if (
                        statusActive &&
                        !selectedHouseStatuses.has(HOUSE_LINK_VISUAL[row.state].key)
                    ) {
                        continue;
                    }
                    shown.push(row);
                }
                const unmatchedFunctionsFirst =
                    t.type === "FUNCTION" && getUnmatchedFunctionsFirst();
                shown.sort((a, b) => compareHouseRows(a, b, unmatchedFunctionsFirst));
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
                                itemRow(t, uuid, s.item, items, inCurrentHouse, s.state)
                            ),
                        })
                    );
                }
            }
            out.push(queueActionBar(t, uuid, items, allRows, shown, inCurrentHouse));
            return out;
        },
    });
}
