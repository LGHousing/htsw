/// <reference types="../../../../CTAutocomplete" />

import { Element, Rect } from "../../lib/layout";
import { Button, Col, Container, Icon, Input, Row, Scroll, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    getExportImportJsonPath,
    getHousingUuid,
    isHouseTrusted,
    setHousingUuid,
    setHouseTrust,
} from "../../state";
import { GLYPH_DOT } from "../../lib/theme";
import { shortPath } from "../../lib/pathDisplay";
import { parseImportJsonAt } from "../../parsing/parses";
import { getCurrentHousingUuid } from "../../../importCache/housingId";
import { getAlias, listAliases } from "../../../importCache/aliases";
import { openAliasPopover } from "../../popovers/alias";
import { openMenu, type MenuAction } from "../../lib/menu";
import { togglePopover, closePopover, type PopoverHandle } from "../../lib/popovers";
import { exportDestinationPicker } from "../../right-panel/import-tab/importButtons";
import {
    startExportAllFunctions,
    startExportFunctions,
} from "../../right-panel/import-tab/importController";
import {
    clearExportQueue,
    getExportQueue,
    isInExportQueue,
    toggleExportQueue,
} from "./exportQueue";
import { TaskManager } from "../../../tasks/manager";
import { IMPORT_CACHE_ROOT, importableIdentity } from "../../../importCache/paths";
import { deleteHousingCache } from "../../../importCache/cache";
import { clearAlias } from "../../../importCache/aliases";
import { javaType } from "../../lib/java";
import {
    ACCENT_DANGER,
    ACCENT_SUCCESS,
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
    SIZE_ROW_H,
} from "../../lib/theme";
import { KNOWLEDGE_TYPES, type KnowledgeType } from "./types";
import { type HouseItem, isScanInFlight } from "./houseItems";

// Read-only trust glyph tint: green when trusted, faint otherwise. Toggling
// trust lives only on the Import-tab Trust button; here it's a status icon.
const TRUST_ICON_ON = 0xff5cb85c | 0;

// Rhino lacks String.prototype.repeat, so cycle through a fixed table.
const SCAN_DOTS = ["", ".", "..", "..."];

function scanLabel(scanned: boolean): string {
    if (isScanInFlight()) {
        return `Scanning${SCAN_DOTS[Math.floor(Date.now() / 350) % SCAN_DOTS.length]}`;
    }
    return scanned ? "Rescan" : "Scan";
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

function shortUuid(uuid: string): string {
    if (uuid.length <= 18) return uuid;
    return `${uuid.substring(0, 8)}…${uuid.substring(uuid.length - 6)}`;
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
    const label = getAlias(uuid) ?? shortUuid(uuid);
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
    return getAlias(uuid) ?? shortUuid(uuid);
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
            Icon({
                name: isCurrent ? Icons.target : Icons.circle,
                style: { width: { kind: "px", value: 10 }, height: { kind: "px", value: 10 } },
            }),
            Text({
                text: houseLabel(uuid),
                color: COLOR_TEXT,
                style: { width: { kind: "grow" } },
            }),
            Text({ text: isCurrent ? "current" : "", color: COLOR_TEXT_FAINT }),
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
                    openMenu(
                        info.x,
                        info.y,
                        [
                            {
                                label: `Confirm delete ${houseLabel(uuid)}`,
                                onClick: () => {
                                    deleteHouse(uuid);
                                    closeHouseDropdown();
                                },
                            },
                        ],
                        { keepUnderlying: true }
                    );
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
                          id: "knowledge-house-dropdown-scroll",
                          style: { gap: DROPDOWN_GAP, height: { kind: "px", value: listH } },
                          children: houses.map(houseDropdownRow),
                      }),
                  ],
              });
    houseDropdownHandle = togglePopover({
        key: "knowledge-house-dropdown",
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

// Single title row: house dropdown trigger, with a read-only trust shield on
// the left and a refresh/re-detect icon on the right. Trust is toggled only
// from the Import tab; here the shield just reflects it. Alias lives in the
// row's right-click menu (and on the Import header), since it's set rarely.
function housePickerRow(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            gap: 6,
            padding: { side: "x", value: 8 },
            width: { kind: "grow" },
            height: { kind: "px", value: SIZE_ROW_H + 6 },
            background: COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        onClick: (rect, info) => {
            const viewed = viewedUuid();
            if (info.button === 1) {
                if (viewed !== null) {
                    openMenu(info.x, info.y, [
                        { label: "Set alias", onClick: () => openAliasPopover(rect, viewed) },
                        { kind: "separator" },
                        { label: "Delete tracked house", onClick: () => deleteHouse(viewed) },
                    ]);
                }
                return;
            }
            openHouseDropdown(rect);
        },
        children: () => {
            const viewed = viewedUuid();
            const isHere = viewed !== null && viewed === getHousingUuid();
            const trusted = viewed !== null && isHouseTrusted(viewed);
            return [
                Icon({
                    name: trusted ? Icons.shieldCheck : Icons.shield,
                    color: trusted ? TRUST_ICON_ON : COLOR_TEXT_FAINT,
                    style: {
                        width: { kind: "px", value: 12 },
                        height: { kind: "px", value: 12 },
                    },
                }),
                Text({
                    text: houseLabel(viewed),
                    color: COLOR_TEXT,
                    style: { width: { kind: "grow" } },
                }),
                isHere &&
                    Text({
                        text: "current",
                        color: COLOR_TEXT_FAINT,
                        style: { padding: { side: "right", value: 4 } },
                    }),
                Button({
                    icon: Icons.radar,
                    style: {
                        width: { kind: "px", value: 22 },
                        height: { kind: "grow" },
                        background: COLOR_BUTTON,
                        hoverBackground: COLOR_BUTTON_HOVER,
                    },
                    onClick: () => detectHousing(),
                }),
                Icon({
                    name: Icons.chevronDown,
                    style: {
                        width: { kind: "px", value: 10 },
                        height: { kind: "px", value: 10 },
                    },
                }),
            ];
        },
    });
}

let activeKnowledgeType: KnowledgeType["type"] = KNOWLEDGE_TYPES[0].type;
let itemSearch = "";

function activeType(): KnowledgeType {
    for (let i = 0; i < KNOWLEDGE_TYPES.length; i++) {
        if (KNOWLEDGE_TYPES[i].type === activeKnowledgeType) return KNOWLEDGE_TYPES[i];
    }
    return KNOWLEDGE_TYPES[0];
}

function typeTabButton(t: KnowledgeType): Element {
    const isActive = activeKnowledgeType === t.type;
    return Button({
        icon: t.icon,
        text: t.label,
        style: {
            width: { kind: "grow" },
            height: { kind: "grow" },
            background: isActive ? COLOR_TAB_ACTIVE : COLOR_TAB,
            hoverBackground: isActive ? COLOR_TAB_ACTIVE_HOVER : COLOR_TAB_HOVER,
        },
        onClick: () => {
            activeKnowledgeType = t.type;
        },
    });
}

function itemRowMenu(t: KnowledgeType, uuid: string, name: string, canExport: boolean): MenuAction[] {
    const actions: MenuAction[] = [];
    if (t.run !== undefined) actions.push({ label: "Run", onClick: () => t.run?.(name) });
    if (t.edit !== undefined) actions.push({ label: "Edit", onClick: () => t.edit?.(name) });
    if (canExport) {
        const selected = isInExportQueue(uuid, t.type, name);
        actions.push({
            label: selected ? "Deselect" : "Select for export",
            onClick: () => {
                toggleExportQueue({ uuid, type: t.type, name });
            },
        });
    }
    if (t.remove !== undefined) {
        actions.push({ kind: "separator" });
        actions.push({ label: "Delete", onClick: () => t.remove?.(name) });
    }
    return actions;
}

// Identities of this type already present in the selected export destination,
// so a row can show whether it's already been written there. Empty when no
// destination is set or it doesn't parse.
function exportedIdentities(type: KnowledgeType["type"]): Set<string> {
    const out = new Set<string>();
    const dest = getExportImportJsonPath();
    if (dest.trim() === "") return out;
    const parse = parseImportJsonAt(dest);
    if (parse.parsed === null) return out;
    for (const imp of parse.parsed.value) {
        if (imp.type === type) out.add(importableIdentity(imp));
    }
    return out;
}

function itemRow(
    t: KnowledgeType,
    uuid: string,
    item: HouseItem,
    interactive: boolean,
    canExport: boolean,
    exported: boolean
): Element {
    const selected = canExport && isInExportQueue(uuid, t.type, item.name);
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
                  if (canExport) toggleExportQueue({ uuid, type: t.type, name: item.name });
              }
            : undefined,
        children: [
            canExport
                ? Icon({
                      name: selected ? Icons.squareCheck : Icons.square,
                      style: {
                          width: { kind: "px", value: 12 },
                          height: { kind: "px", value: 12 },
                      },
                  })
                : Text({
                      text: GLYPH_DOT,
                      color: COLOR_TEXT_DIM,
                      style: { width: { kind: "px", value: 8 } },
                  }),
            Text({
                text: item.name,
                color: COLOR_TEXT,
                style: { width: { kind: "grow" } },
            }),
            Text({
                text: GLYPH_DOT,
                color: exported ? ACCENT_SUCCESS : COLOR_TEXT_FAINT,
                style: { width: { kind: "px", value: 10 } },
                tooltip: exported
                    ? "In the selected import.json"
                    : "Not in the selected import.json",
                tooltipColor: exported ? ACCENT_SUCCESS : COLOR_TEXT_DIM,
            }),
        ],
    });
}

function exportActionBar(t: KnowledgeType, uuid: string, totalCount: number): Element {
    const selected = getExportQueue().filter(
        (it) => it.uuid === uuid && it.type === t.type
    );
    const selectedCount = selected.length;
    return Col({
        style: { gap: 4 },
        children: [
            Row({
                style: { gap: 4, height: { kind: "px", value: SIZE_ROW_H } },
                children: [
                    Text({
                        text: () => {
                            const d = getExportImportJsonPath();
                            return d.trim() === "" ? "No destination" : `→ ${shortPath(d)}`;
                        },
                        color: COLOR_TEXT_DIM,
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
                                key: "knowledge-export-destination",
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
                        icon: Icons.fileUp,
                        text:
                            selectedCount > 0
                                ? `Export Selected (${selectedCount})`
                                : `Export All (${totalCount})`,
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON_PRIMARY,
                            hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                        },
                        onClick: () => {
                            if (selectedCount > 0) {
                                const names = selected.map((it) => it.name);
                                startExportFunctions(names, () => clearExportQueue());
                            } else {
                                startExportAllFunctions();
                            }
                        },
                    }),
                    selectedCount > 0 &&
                        Button({
                            icon: Icons.x,
                            style: {
                                width: { kind: "px", value: 22 },
                                height: { kind: "grow" },
                                background: COLOR_BUTTON,
                                hoverBackground: COLOR_BUTTON_HOVER,
                            },
                            onClick: () => clearExportQueue(),
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
            const canExport = t.exportable === true && canScan;
            const tabStrip = KNOWLEDGE_TYPES.map(typeTabButton);
            if (canScan) {
                tabStrip.push(
                    Button({
                        icon: Icons.scan,
                        text: scanLabel(t.scanned(uuid)),
                        style: {
                            width: { kind: "px", value: 72 },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: () => {
                            if (!isScanInFlight()) t.scan();
                        },
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
                            return isScanInFlight()
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
                    id: "knowledge-item-search",
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
                const exported = exportedIdentities(t.type);
                out.push(
                    Scroll({
                        id: "knowledge-type-scroll",
                        style: { height: { kind: "grow" }, gap: 1 },
                        children: shown.map((i) =>
                            itemRow(t, uuid, i, canScan, canExport, exported.has(i.name))
                        ),
                    })
                );
            }
            if (canExport) out.push(exportActionBar(t, uuid, items.length));
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
                icon: Icons.radar,
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

export function KnowledgeView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" }, padding: 4 },
        children: () => {
            if (knownHouses().length === 0) return [emptyState()];
            return [housePickerRow(), typeBrowserSection()];
        },
    });
}
