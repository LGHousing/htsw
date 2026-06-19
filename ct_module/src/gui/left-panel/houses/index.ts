/// <reference types="../../../../CTAutocomplete" />

import { Element, Rect } from "../../lib/layout";
import { Button, Col, Container, Icon, Input, Row, Scroll, Text } from "../../lib/components";
import { Icons, IconName } from "../../lib/icons.generated";
import {
    getExportImportJsonPath,
    getHousingUuid,
    isHouseTrusted,
    setHousingUuid,
    setHouseTrust,
} from "../../state";
import { GLYPH_DOT } from "../../lib/theme";
import { shortPath } from "../../lib/pathDisplay";
import { canonicalPath, requestParse } from "../../parsing/parses";
import { boundImportJsonPath } from "../../../importCache/houseBindings";
import { getCurrentHousingUuid } from "../../../importCache/housingId";
import { houseDisplayName, listAliases } from "../../../importCache/aliases";
import { openAliasPopover } from "../../popovers/alias";
import { openConfirmPopover } from "../../popovers/confirm";
import { openMenu, type MenuAction } from "../../lib/menu";
import { togglePopover, closePopover, type PopoverHandle } from "../../lib/popovers";
import { exportDestinationPicker } from "../../right-panel/import-tab/importButtons";
import {
    clearExportSelection,
    getExportSelection,
    isInExportSelection,
    toggleExportSelection,
} from "./exportSelection";
import { TaskManager } from "../../../tasks/manager";
import { IMPORT_CACHE_ROOT, importableIdentity } from "../../../importCache/paths";
import { deleteHousingCache } from "../../../importCache/cache";
import { clearAlias } from "../../../importCache/aliases";
import { javaType } from "../../lib/java";
import {
    ACCENT_DANGER,
    ACCENT_SUCCESS,
    ACCENT_WARN,
    COLOR_BUTTON,
    COLOR_BUTTON_DANGER_HOVER,
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
    COLOR_TOGGLE_ON,
    COLOR_TOGGLE_ON_HOVER,
    SIZE_ROW_H,
} from "../../lib/theme";
import { HOUSE_CONTENT_TYPES, type HouseContentType } from "./types";
import { type HouseImportable } from "../../../importCache/cache";
import { buildCacheStatusRow } from "../../../importCache/status";
import { confirmSelect } from "../../right-panel/selection";
import { importableSourcePath } from "../../parsing/importablePaths";
import { linkStatusIcon, type LinkStatusKey } from "../../cache-status";
import type { Importable } from "htsw/types";

// Trust glyph tint: green when trusted, faint otherwise.
const TRUST_ICON_ON = 0xff5cb85c | 0;

// Rhino lacks String.prototype.repeat, so cycle through a fixed table.
const SCAN_DOTS = ["", ".", "..", "..."];

function scanLabel(t: HouseContentType, uuid: string | null): string {
    if (t.scanInFlight()) {
        return `Scanning${SCAN_DOTS[Math.floor(Date.now() / 350) % SCAN_DOTS.length]}`;
    }
    return t.scanned(uuid) ? "Rescan" : "Scan";
}

function detectHousing(): void {
    TaskManager.run(async (ctx) => {
        try {
            const uuid = await getCurrentHousingUuid(ctx);
            setHousingUuid(uuid);
            ChatLib.chat(`&a[htsw] Housing UUID: ${uuid}`);
        } catch (err) {
            ChatLib.chat(`&c[htsw] Detect failed: ${err}`);
        }
    }).catch((err: unknown) => {
        ChatLib.chat(`&c[htsw] Detect task failed: ${err}`);
    });
}

/** Enumerate every UUID dir under the import cache root. Best-effort:
 *  failures (missing dir, permissions) yield an empty list. */
function listCachedHousingUuids(): string[] {
    try {
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
        const root = Paths.get(String(IMPORT_CACHE_ROOT));
        if (!Files.exists(root) || !Files.isDirectory(root)) return [];
        const stream = Files.newDirectoryStream(root);
        const out: string[] = [];
        try {
            const it = stream.iterator();
            while (it.hasNext()) {
                const entry = it.next();
                if (!Files.isDirectory(entry)) continue;
                const name = String(entry.getFileName().toString());
                out.push(name);
            }
        } finally {
            try { stream.close(); } catch (_e) { /* ignore */ }
        }
        return out;
    } catch (_e) {
        return [];
    }
}

/** All houses we know about: cache directories ∪ aliased UUIDs ∪ the
 *  currently-detected housing. Deduplicated. */
function knownHouses(): string[] {
    const set = new Set<string>();
    for (const u of listCachedHousingUuids()) set.add(u);
    const aliases = listAliases();
    for (const k in aliases) set.add(k);
    const current = getHousingUuid();
    if (current !== null) set.add(current);
    const out: string[] = [];
    for (const u of set) out.push(u);
    out.sort();
    return out;
}

function confirmDeleteHouse(uuid: string, onDeleted?: () => void): void {
    openConfirmPopover({
        title: `Remove tracked house ${houseLabel(uuid)}?`,
        lines: ["Deletes its cached knowledge, alias, and trust."],
        confirmLabel: "Remove",
        danger: true,
        onConfirm: () => {
            deleteHouse(uuid);
            onDeleted?.();
        },
    });
}

function deleteHouse(uuid: string): void {
    const ok = deleteHousingCache(uuid);
    clearAlias(uuid);
    setHouseTrust(uuid, false);
    if (getHousingUuid() === uuid) {
        setHousingUuid(null);
    }
    // Don't leave the browser pinned to a house that no longer exists; fall
    // back to tracking the in-game house.
    if (viewedHouse === uuid) {
        viewedHouse = null;
    }
    const label = houseDisplayName(uuid);
    if (ok) ChatLib.chat(`&a[htsw] Removed tracked house ${label}.`);
    else ChatLib.chat(`&e[htsw] No cache directory for ${label} (alias/trust cleared anyway).`);
}

// The house the browser is showing. Null tracks the in-game house, so the
// picker defaults to "where you are" and only sticks to another house once you
// explicitly pick one from the dropdown.
let viewedHouse: string | null = null;

function viewedUuid(): string | null {
    return viewedHouse ?? getHousingUuid();
}

function houseLabel(uuid: string | null): string {
    if (uuid === null) return "(no house)";
    return houseDisplayName(uuid);
}

let houseDropdownHandle: PopoverHandle | null = null;

function closeHouseDropdown(): void {
    if (houseDropdownHandle !== null) {
        closePopover(houseDropdownHandle);
        houseDropdownHandle = null;
    }
}

function houseDropdownRow(uuid: string): Element {
    const isViewed = uuid === viewedUuid();
    const isCurrent = uuid === getHousingUuid();
    return Container({
        style: {
            direction: "row",
            align: "center",
            gap: 8,
            padding: { side: "x", value: 8 },
            height: { kind: "px", value: SIZE_ROW_H },
            background: isViewed ? COLOR_ROW_SELECTED : COLOR_ROW,
            hoverBackground: isViewed ? COLOR_ROW_SELECTED_HOVER : COLOR_ROW_HOVER,
        },
        onClick: (_rect, info) => {
            if (info.button !== 0) return;
            viewedHouse = uuid;
            closeHouseDropdown();
        },
        children: [
            Text({
                text: houseLabel(uuid),
                color: COLOR_TEXT,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            (() => {
                const bound = boundImportJsonPath(uuid);
                if (bound === null) return false;
                return Icon({
                    name: Icons.house,
                    color: ACCENT_SUCCESS,
                    tooltip: `Bound: ${shortPath(bound)}`,
                    tooltipColor: ACCENT_SUCCESS,
                    style: { width: { kind: "px", value: 10 }, height: { kind: "px", value: 10 } },
                });
            })(),
            isCurrent &&
                Icon({
                    name: Icons.target,
                    color: COLOR_TEXT_DIM,
                    tooltip: "Current house",
                    tooltipColor: COLOR_TEXT_DIM,
                    style: { width: { kind: "px", value: 10 }, height: { kind: "px", value: 10 } },
                }),
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    justify: "center",
                    width: { kind: "px", value: 18 },
                    height: { kind: "px", value: 18 },
                    hoverBackground: COLOR_BUTTON_DANGER_HOVER,
                },
                onClick: (_r, info) => {
                    if (info.button !== 0) return;
                    confirmDeleteHouse(uuid, () => closeHouseDropdown());
                },
                children: [
                    Icon({
                        name: Icons.trash2,
                        color: ACCENT_DANGER,
                        style: { width: { kind: "px", value: 12 }, height: { kind: "px", value: 12 } },
                        tooltip: "Remove this house",
                        tooltipColor: ACCENT_DANGER,
                    }),
                ],
            }),
        ],
    });
}

const DROPDOWN_PAD = 4;
const DROPDOWN_GAP = 1;
const DROPDOWN_MAX_ROWS = 6;

function openHouseDropdown(rect: Rect): void {
    const houses = knownHouses();
    const visibleRows = Math.min(houses.length, DROPDOWN_MAX_ROWS);
    const listH = visibleRows * SIZE_ROW_H + (visibleRows - 1) * DROPDOWN_GAP;
    const content: Element =
        houses.length <= DROPDOWN_MAX_ROWS
            ? Col({
                  style: { padding: DROPDOWN_PAD, gap: DROPDOWN_GAP },
                  children: houses.map(houseDropdownRow),
              })
            : Col({
                  style: { padding: DROPDOWN_PAD },
                  children: [
                      Scroll({
                          id: "houses-house-dropdown-scroll",
                          style: { gap: DROPDOWN_GAP, height: { kind: "px", value: listH } },
                          children: houses.map(houseDropdownRow),
                      }),
                  ],
              });
    houseDropdownHandle = togglePopover({
        key: "houses-house-dropdown",
        anchor: rect,
        content,
        width: rect.w,
        height: listH + DROPDOWN_PAD * 2,
        placement: "anchored",
        onClose: () => {
            houseDropdownHandle = null;
        },
    });
}

function trustButton(uuid: string | null, trusted: boolean): Element {
    const enabled = uuid !== null;
    return Button({
        style: {
            width: { kind: "px", value: 76 },
            height: { kind: "grow" },
            background: trusted ? COLOR_TOGGLE_ON : COLOR_BUTTON,
            hoverBackground: trusted ? COLOR_TOGGLE_ON_HOVER : COLOR_BUTTON_HOVER,
        },
        onClick: () => {
            if (uuid === null) return;
            setHouseTrust(uuid, !trusted);
        },
        children: [
            Icon({
                name: trusted ? Icons.shieldCheck : Icons.shield,
                color: trusted ? TRUST_ICON_ON : COLOR_TEXT_DIM,
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                },
            }),
            Text({
                text: trusted ? "Trusted" : "Trust",
                color: enabled ? COLOR_TEXT : COLOR_TEXT_FAINT,
            }),
        ],
    });
}

function houseSelector(viewed: string | null, isHere: boolean): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            gap: 6,
            padding: { side: "x", value: 8 },
            width: { kind: "grow" },
            height: { kind: "grow" },
            background: COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        onClick: (rect, info) => {
            if (info.button === 1) {
                if (viewed !== null) {
                    openMenu(info.x, info.y, [
                        { label: "Set alias", onClick: () => openAliasPopover(rect, viewed) },
                        { kind: "separator" },
                        { label: "Delete tracked house", onClick: () => confirmDeleteHouse(viewed) },
                    ]);
                }
                return;
            }
            openHouseDropdown(rect);
        },
        children: [
            Text({
                text: houseLabel(viewed),
                color: COLOR_TEXT,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            isHere &&
                Icon({
                    name: Icons.target,
                    color: COLOR_TEXT_DIM,
                    tooltip: "Current house",
                    tooltipColor: COLOR_TEXT_DIM,
                    style: { width: { kind: "px", value: 10 }, height: { kind: "px", value: 10 } },
                }),
            Icon({
                name: Icons.chevronDown,
                style: {
                    width: { kind: "px", value: 10 },
                    height: { kind: "px", value: 10 },
                },
            }),
        ],
    });
}

// Compact square icon button for the house's secondary actions (rename,
// detect). Each carries a tooltip — a bare icon here reads as a mystery glyph.
function houseActionButton(
    icon: IconName,
    tooltip: string,
    onClick: (rect: Rect) => void
): Element {
    return Button({
        children: [
            Icon({
                name: icon,
                tooltip,
                tooltipColor: COLOR_TEXT_DIM,
                style: { width: { kind: "px", value: 12 }, height: { kind: "px", value: 12 } },
            }),
        ],
        style: {
            width: { kind: "px", value: 24 },
            height: { kind: "grow" },
            background: COLOR_BUTTON,
            hoverBackground: COLOR_BUTTON_HOVER,
        },
        onClick,
    });
}

// Single title row: house selector, trust/alias controls, and re-detect.
function housePickerRow(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            gap: 6,
            padding: { side: "x", value: 8 },
            width: { kind: "grow" },
            height: { kind: "px", value: SIZE_ROW_H + 6 },
            background: 0x00000000 | 0,
        },
        children: () => {
            const viewed = viewedUuid();
            const isHere = viewed !== null && viewed === getHousingUuid();
            const trusted = viewed !== null && isHouseTrusted(viewed);
            return [
                houseSelector(viewed, isHere),
                trustButton(viewed, trusted),
                houseActionButton(Icons.pencil, "Rename this house", (rect: Rect) => {
                    if (viewed === null) return;
                    openAliasPopover(rect, viewed);
                }),
                houseActionButton(
                    Icons.locateFixed,
                    "Detect the house you're standing in",
                    () => detectHousing()
                ),
            ];
        },
    });
}

let activeContentType: HouseContentType["type"] = HOUSE_CONTENT_TYPES[0].type;
let itemSearch = "";

function activeType(): HouseContentType {
    for (let i = 0; i < HOUSE_CONTENT_TYPES.length; i++) {
        if (HOUSE_CONTENT_TYPES[i].type === activeContentType) return HOUSE_CONTENT_TYPES[i];
    }
    return HOUSE_CONTENT_TYPES[0];
}

function typeTabButton(t: HouseContentType): Element {
    const isActive = activeContentType === t.type;
    return Button({
        children: [
            Icon({ name: t.icon }),
            Text({ text: t.label, truncate: true, style: { width: { kind: "grow" } } }),
        ],
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
            return importableSourcePath(imp, parse.parsed) ?? null;
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
                confirmSelect(sourcePath);
            },
        });
    }
    if (t.run !== undefined)
        actions.push({ label: "Run", icon: Icons.play, onClick: () => t.run?.(name) });
    if (t.edit !== undefined)
        actions.push({ label: "Edit", icon: Icons.pencil, onClick: () => t.edit?.(name) });
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
            interactive &&
                t.run !== undefined &&
                Container({
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
                        t.run?.(item.name);
                    },
                    children: [
                        Icon({
                            name: Icons.play,
                            color: COLOR_TEXT_DIM,
                            tooltip: "Run",
                            tooltipColor: COLOR_TEXT_DIM,
                            style: {
                                width: { kind: "px", value: 12 },
                                height: { kind: "px", value: 12 },
                            },
                        }),
                    ],
                }),
            interactive &&
                t.edit !== undefined &&
                Container({
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
                        t.edit?.(item.name);
                    },
                    children: [
                        Icon({
                            name: Icons.pencil,
                            color: COLOR_TEXT_DIM,
                            tooltip: "Edit",
                            tooltipColor: COLOR_TEXT_DIM,
                            style: {
                                width: { kind: "px", value: 12 },
                                height: { kind: "px", value: 12 },
                            },
                        }),
                    ],
            }),
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
    // "Unexported" = house items whose identity isn't already in the loaded
    // import.json (the faint right-dot in each row). Same comparison itemRow uses.
    const exportedSet = exportedIdentities(t.type);
    const unexportedNames = t
        .items(uuid)
        .filter((i) => !exportedSet.has(i.name))
        .map((i) => i.name);
    // Without a destination import.json every export path just toasts "pick a
    // destination first", so grey the export split-button to say so up front.
    // The Change button stays enabled — it's how you pick one.
    const hasDest = getExportImportJsonPath().trim() !== "";
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
                        // Bound-file indicator: green house = the destination IS
                        // this house's bound import.json; yellow = the house has
                        // a bound file but the destination is something else.
                        const bound = boundImportJsonPath(uuid);
                        if (bound === null) return false;
                        const d = getExportImportJsonPath();
                        const matches = d.trim() !== "" && canonicalPath(d) === bound;
                        return Icon({
                            name: Icons.house,
                            color: matches ? ACCENT_SUCCESS : ACCENT_WARN,
                            tooltip: matches
                                ? "Destination is this house's bound file"
                                : `This house's bound file is ${shortPath(bound)}`,
                            tooltipColor: matches ? ACCENT_SUCCESS : ACCENT_WARN,
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
                                height: 220,
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
                        onClick: () => {
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
                        // Anchor to the caret's rect (not the cursor) so the menu
                        // right-aligns under the button and drops up consistently.
                        onClick: (rect: Rect) => {
                            if (t.export === undefined) return;
                            const exp = t.export;
                            // The yellow "differs" rows: in your file but the
                            // house version has diverged. Computed exactly as the
                            // rows render their status so the count matches what
                            // you see. Export pulls the house version over local,
                            // so it always routes through the overwrite confirm.
                            const trusted = isHouseTrusted(uuid);
                            const sourceMap = sourceImportablesByType(t.type);
                            const differingNames = t
                                .items(uuid)
                                .filter(
                                    (i) =>
                                        houseLinkStateFor(uuid, i, sourceMap, trusted) ===
                                        "differs-from-knowledge"
                                )
                                .map((i) => i.name);
                            const actions: MenuAction[] = [
                                {
                                    // Unexported names aren't in your file, so
                                    // they are not compared against Knowledge — no confirm.
                                    label: `Export unexported (${unexportedNames.length})`,
                                    onClick: () => {
                                        if (unexportedNames.length > 0) {
                                            exp.selected(unexportedNames, () =>
                                                clearExportSelection()
                                            );
                                        }
                                    },
                                },
                                {
                                    label: `Export differing (${differingNames.length})`,
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
                            openMenu(rect.x + rect.w, rect.y, actions);
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

function typeBrowserSection(): Element {
    return Col({
        style: { gap: 4, height: { kind: "grow" } },
        children: () => {
            const t = activeType();
            const uuid = viewedUuid();
            // You can only open /functions for the house you're standing in, so
            // Scan (and export, which reads the live menu) is only offered when
            // the viewed house is the current one.
            const canScan = uuid !== null && uuid === getHousingUuid();
            const canExport = t.export !== undefined && canScan;
            const tabStrip = HOUSE_CONTENT_TYPES.map(typeTabButton);
            if (canScan) {
                // Icon-only reload button, not a text tab — at tab width + with a
                // label it read as a fourth type tab you'd click by mistake.
                tabStrip.push(
                    Button({
                        style: {
                            width: { kind: "px", value: 22 },
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
                    style: { gap: 2, height: { kind: "px", value: 18 } },
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

function emptyState(): Element {
    return Col({
        style: { gap: 4, padding: 6 },
        children: [
            Text({
                text: "No houses known yet.",
                color: COLOR_TEXT_DIM,
            }),
            Text({
                text: "Run an import or click Detect to register one.",
                color: COLOR_TEXT_FAINT,
            }),
            Button({
                icon: Icons.locateFixed,
                text: "Detect (/wtfmap)",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 18 },
                },
                onClick: () => detectHousing(),
            }),
        ],
    });
}

export function HousesView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" }, padding: 4 },
        children: () => {
            if (knownHouses().length === 0) return [emptyState()];
            return [housePickerRow(), typeBrowserSection()];
        },
    });
}
