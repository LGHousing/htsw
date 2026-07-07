/// <reference types="../../../../CTAutocomplete" />

import { Element, Rect } from "../../lib/layout";
import { Button, Col, Container, Icon, Input, Row, Scroll, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    getExportImportJsonPath,
    getHousingUuid,
    isHouseTrusted,
} from "../../state";
import { GLYPH_DOT } from "../../lib/theme";
import { shortPath } from "../../lib/pathDisplay";
import { canonicalPath, requestParse } from "../../parsing/parses";
import { boundImportJsonPath } from "../../../importCache/houseBindings";
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
    ACCENT_SUCCESS,
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
import type { Importable } from "htsw/types";
import { boundHouseUuidOf, confirmRebind } from "../../houseBinding";
import { TAB_GAP, tabLabelsFit } from "../tabs";

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

// House-side wording for the shared link-status icons. The Importables page
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
// row can be diffed against your file. Non-blocking parse — empty until warm.
function sourceImportablesByType(type: HouseContentType["type"]): Map<string, Importable> {
    const out = new Map<string, Importable>();
    const dest = getExportImportJsonPath();
    if (dest.trim() === "") return out;
    const parse = requestParse(dest);
    if (parse === null || parse.parsed === null) return out;
    for (const imp of parse.parsed.value) {
        if (imp.type === type) out.set(importableIdentity(imp), imp);
    }
    return out;
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

function differsFromKnowledge(
    uuid: string,
    item: HouseImportable,
    sourceByKey: Map<string, Importable>
): boolean {
    const source = sourceByKey.get(item.name);
    if (source === undefined || !item.verified) return false;
    return buildCacheStatusRow(uuid, source).state === "modified";
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
            Text({
                text: item.name,
                color: COLOR_TEXT,
                truncate: true,
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

function namesChangedFromKnowledge(
    t: HouseContentType,
    uuid: string,
    names: readonly string[]
): string[] {
    const sourceMap = sourceImportablesByType(t.type);
    const byName = new Map<string, HouseImportable>();
    for (const item of t.items(uuid)) byName.set(item.name, item);
    const out: string[] = [];
    for (const n of names) {
        const item = byName.get(n);
        if (item !== undefined && differsFromKnowledge(uuid, item, sourceMap)) {
            out.push(n);
        }
    }
    return out;
}

// Export overwrites local files with the house version. When the export set
// contains rows that differ from Knowledge, interpose a modal confirm naming
// what gets overwritten.
function confirmDestructiveExport(
    t: HouseContentType,
    uuid: string,
    names: readonly string[],
    run: () => void
): void {
    const changed = namesChangedFromKnowledge(t, uuid, names);
    if (changed.length === 0) {
        run();
        return;
    }
    const shown = changed.slice(0, 5);
    const lines = shown.map((n) => `• ${n}`);
    if (changed.length > shown.length) {
        lines.push(`…and ${changed.length - shown.length} more`);
    }
    lines.push("Export pulls the house version over your local files.");
    openConfirmPopover({
        title: `Overwrite local changes to ${changed.length} ${t.label.toLowerCase()}?`,
        lines,
        confirmLabel: "Export anyway",
        danger: true,
        onConfirm: run,
    });
}

function exportActionBar(t: HouseContentType, uuid: string, totalCount: number): Element {
    const selected = getExportSelection().filter(
        (it) => it.uuid === uuid && it.type === t.type
    );
    const selectedCount = selected.length;
    // Missing = house items whose identity isn't already in the loaded
    // import.json. Same comparison itemRow uses.
    const exportedSet = exportedIdentities(t.type);
    const missingNames = t
        .items(uuid)
        .filter((i) => !exportedSet.has(i.name))
        .map((i) => i.name);
    const hasDest = getExportImportJsonPath().trim() !== "";
    const destBound = hasDest ? boundHouseUuidOf(getExportImportJsonPath()) : null;
    const destBoundHere = destBound !== null && destBound === uuid;
    const canBindDest = hasDest && !destBoundHere;
    return Col({
        // Right inset so the caret split-button isn't flush against the panel
        // edge (it sat right at the boundary and read as clipped).
        style: { gap: 4, padding: { side: "right", value: 8 } },
        children: [
            Row({
                style: {
                    gap: 4,
                    height: { kind: "px", value: SIZE_ROW_H },
                    align: "center",
                },
                children: [
                    (() => {
                        const bound = boundImportJsonPath(uuid);
                        if (bound === null) return false;
                        const d = getExportImportJsonPath();
                        const matches = d.trim() !== "" && canonicalPath(d) === bound;
                        const color = uuid === getHousingUuid() ? ACCENT_SUCCESS : COLOR_TEXT_FAINT;
                        return Icon({
                            name: Icons.house,
                            color,
                            tooltip: matches
                                ? "Destination is this house's bound file"
                                : `This house's bound file is ${shortPath(bound)}`,
                            tooltipColor: color,
                            style: {
                                width: { kind: "px", value: 10 },
                                height: { kind: "px", value: 10 },
                            },
                        });
                    })(),
                    Text({
                        text: () => {
                            const d = getExportImportJsonPath();
                            return d.trim() === "" ? "No export destination" : `→ ${shortPath(d)}`;
                        },
                        color: COLOR_TEXT_DIM,
                        truncate: true,
                        style: {
                            width: { kind: "grow" },
                            padding: { side: "x", value: 4 },
                        },
                    }),
                    Button({
                        text: destBoundHere ? "Bound" : "Bind",
                        textColor: canBindDest ? undefined : COLOR_TEXT_FAINT,
                        style: {
                            width: { kind: "px", value: 52 },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: canBindDest ? COLOR_BUTTON_HOVER : COLOR_BUTTON,
                        },
                        tooltip: !hasDest
                            ? "Choose a destination first"
                            : destBoundHere
                              ? "Destination is already bound to this house"
                              : "Bind destination to this house",
                        tooltipColor: canBindDest ? COLOR_TEXT_DIM : COLOR_TEXT_FAINT,
                        disabled: !canBindDest,
                        onClick: () => {
                            if (!canBindDest) return;
                            confirmRebind(getExportImportJsonPath(), uuid);
                        },
                    }),
                    Button({
                        text: "Change",
                        style: {
                            width: { kind: "px", value: 60 },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: (rect: Rect) =>
                            togglePopover({
                                key: "houses-export-destination",
                                anchor: rect,
                                content: exportDestinationPicker(),
                                width: 360,
                                height: 240,
                            }),
                    }),
                ],
            }),
            Row({
                style: { gap: 4, height: { kind: "px", value: 20 } },
                children: [
                    Button({
                        children: [
                            Icon({
                                name: Icons.fileUp,
                                color: hasDest ? undefined : COLOR_TEXT_FAINT,
                            }),
                            Text({
                                text:
                                    selectedCount > 0
                                        ? `Export Selected (${selectedCount})`
                                        : `Export All (${totalCount})`,
                                color: hasDest ? undefined : COLOR_TEXT_FAINT,
                            }),
                        ],
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: hasDest ? COLOR_BUTTON_PRIMARY : COLOR_BUTTON,
                            hoverBackground: hasDest
                                ? COLOR_BUTTON_PRIMARY_HOVER
                                : COLOR_BUTTON,
                        },
                        tooltip: hasDest ? undefined : "Choose a destination first",
                        tooltipColor: COLOR_TEXT_FAINT,
                        disabled: !hasDest,
                        onClick: () => {
                            if (!hasDest) return;
                            if (t.export === undefined) return;
                            const exp = t.export;
                            if (selectedCount > 0) {
                                const names = selected.map((it) => it.name);
                                confirmDestructiveExport(t, uuid, names, () =>
                                    exp.selected(names, () => clearExportSelection())
                                );
                            } else {
                                const names = t.items(uuid).map((i) => i.name);
                                confirmDestructiveExport(t, uuid, names, () => exp.all());
                            }
                        },
                    }),
                    Button({
                        // Explicit 12px icon via children: the `icon:` shorthand
                        // defaults to 16px, which overflows a ~22px button (inner
                        // ~14px after padding) and reads as cut off / off-center.
                        children: [
                            Icon({
                                name: Icons.chevronUp,
                                color: hasDest ? undefined : COLOR_TEXT_FAINT,
                                style: {
                                    width: { kind: "px", value: 12 },
                                    height: { kind: "px", value: 12 },
                                },
                            }),
                        ],
                        style: {
                            width: { kind: "px", value: 22 },
                            height: { kind: "grow" },
                            background: hasDest ? COLOR_BUTTON_PRIMARY : COLOR_BUTTON,
                            hoverBackground: hasDest
                                ? COLOR_BUTTON_PRIMARY_HOVER
                                : COLOR_BUTTON,
                        },
                        tooltip: hasDest ? undefined : "Choose a destination first",
                        tooltipColor: COLOR_TEXT_FAINT,
                        disabled: !hasDest,
                        // Anchor to the caret's rect (not the cursor) so the menu
                        // right-aligns under the button and drops up consistently.
                        onClick: (rect: Rect) => {
                            if (!hasDest) return;
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
                                            exp.selected(unreadNames, () =>
                                                clearExportSelection()
                                            );
                                        }
                                    },
                                },
                                {
                                    label: `Export differing (${differingNames.length})`,
                                    disabled: differingNames.length === 0,
                                    onClick: () => {
                                        if (differingNames.length > 0) {
                                            confirmDestructiveExport(t, uuid, differingNames, () =>
                                                exp.selected(differingNames, () =>
                                                    clearExportSelection()
                                                )
                                            );
                                        }
                                    },
                                },
                                {
                                    label: `Export all (${totalCount})`,
                                    onClick: () => {
                                        const names = t.items(uuid).map((i) => i.name);
                                        confirmDestructiveExport(t, uuid, names, () => exp.all());
                                    },
                                },
                            ];
                            if (t.deepRead !== undefined) {
                                const deepRead = t.deepRead;
                                actions.push({ kind: "separator" });
                                if (selectedCount > 0) {
                                    actions.push({
                                        label: `Read selected into knowledge (${selectedCount})`,
                                        icon: Icons.scanEye,
                                        onClick: () =>
                                            deepRead(selected.map((it) => it.name)),
                                    });
                                }
                                actions.push({
                                    label: `Read all into knowledge (${totalCount}, slow)`,
                                    icon: Icons.scanEye,
                                    onClick: () => deepRead(),
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
            // You can only open /functions for the house you're standing in, so
            // Scan (and export, which reads the live menu) is only offered when
            // the viewed house is the current one.
            const canScan = uuid !== null && uuid === getHousingUuid();
            const canExport = t.export !== undefined && canScan;
            const tabCount = HOUSE_CONTENT_TYPES.length;
            const childCount = canScan ? tabCount + 1 : tabCount;
            const perTab =
                (availW -
                    (canScan ? SCAN_BUTTON_W : 0) -
                    TAB_GAP * (childCount - 1)) /
                tabCount;
            const showLabels = tabLabelsFit(
                perTab,
                HOUSE_CONTENT_TYPES.map((type) => type.label)
            );
            const tabStrip = HOUSE_CONTENT_TYPES.map((type) =>
                typeTabButton(type, showLabels)
            );
            if (canScan) {
                // Icon-only reload button, not a text tab — at tab width + with a
                // label it read as a fourth type tab you'd click by mistake.
                tabStrip.push(
                    Button({
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
                                // "names" + "(fast)" to set it apart from the
                                // slow deep Read, which lives in the export
                                // dropdown ("Read … into knowledge").
                                tooltip: () => {
                                    const l = scanLabel(t, uuid);
                                    return l.indexOf("Scanning") === 0
                                        ? l
                                        : `${l} names (fast)`;
                                },
                                tooltipColor: COLOR_TEXT_DIM,
                                style: {
                                    width: { kind: "px", value: 12 },
                                    height: { kind: "px", value: 12 },
                                },
                            }),
                        ],
                    })
                );
            }
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
            if (!t.scanned(uuid)) {
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
            const items = t.items(uuid);
            if (items.length === 0) {
                out.push(
                    Text({
                        text: `No ${t.label.toLowerCase()} in this house.`,
                        color: COLOR_TEXT_FAINT,
                    })
                );
                return out;
            }
            out.push(
                Input({
                    id: "houses-item-search",
                    value: () => itemSearch,
                    onChange: (v) => {
                        itemSearch = v;
                    },
                    placeholder: `Search ${t.label.toLowerCase()}…`,
                    style: { height: { kind: "px", value: SIZE_ROW_H + 6 } },
                })
            );
            const query = itemSearch.trim().toLowerCase();
            const shown =
                query === ""
                    ? items
                    : items.filter((i) => i.name.toLowerCase().indexOf(query) !== -1);
            if (shown.length === 0) {
                out.push(
                    Text({
                        text: `No ${t.label.toLowerCase()} match "${itemSearch.trim()}".`,
                        color: COLOR_TEXT_FAINT,
                        style: { height: { kind: "grow" } },
                    })
                );
            } else {
                const sourceMap = sourceImportablesByType(t.type);
                const trusted = isHouseTrusted(uuid);
                out.push(
                    Scroll({
                        id: "houses-type-scroll",
                        style: { height: { kind: "grow" }, gap: 1 },
                        children: shown.map((i) =>
                            itemRow(
                                t,
                                uuid,
                                i,
                                canScan,
                                canExport,
                                houseLinkStateFor(uuid, i, sourceMap, trusted)
                            )
                        ),
                    })
                );
            }
            if (canExport) {
                out.push(exportActionBar(t, uuid, items.length));
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
