/// <reference types="../../../../CTAutocomplete" />

import { Element, Rect } from "../../lib/layout";
import { Button, Col, Container, Icon, Scroll, Text } from "../../lib/components";
import { Icons, IconName } from "../../lib/icons.generated";
import {
    getHousingUuid,
    isHouseTrusted,
    setHousingUuid,
    setHouseTrust,
} from "../../state";
import { shortPath } from "../../lib/pathDisplay";
import { boundImportJsonPath } from "../../../importCache/houseBindings";
import { getCurrentHousingUuid } from "../../../importCache/housingId";
import { houseDisplayName, listAliases } from "../../../importCache/aliases";
import { openAliasPopover } from "./aliasPopover";
import { openConfirmPopover } from "../../popovers/confirm";
import { openMenu } from "../../lib/menu";
import { togglePopover, closePopover, type PopoverHandle } from "../../lib/popovers";
import { TaskManager } from "../../../tasks/manager";
import { IMPORT_CACHE_ROOT } from "../../../importCache/paths";
import { deleteHousingCache } from "../../../importCache/cache";
import { clearAlias } from "../../../importCache/aliases";
import { javaType } from "../../lib/java";
import { openBoundProjectForHouse } from "../../boundProject";
import {
    ACCENT_DANGER,
    ACCENT_SUCCESS,
    COLOR_BUTTON,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_BUTTON_HOVER,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_ROW_SELECTED,
    COLOR_ROW_SELECTED_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    COLOR_TOGGLE_ON,
    COLOR_TOGGLE_ON_HOVER,
    SIZE_ROW_H,
} from "../../lib/theme";
import { typeBrowserSection } from "./contentBrowser";

// Trust glyph tint: green when trusted, faint otherwise.
const TRUST_ICON_ON = 0xff5cb85c | 0;

function detectHousing(): void {
    TaskManager.run(async (ctx) => {
        try {
            const uuid = await getCurrentHousingUuid(ctx);
            setHousingUuid(uuid);
            openBoundProjectForHouse(uuid);
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
                const color = isCurrent ? ACCENT_SUCCESS : COLOR_TEXT_FAINT;
                return Icon({
                    name: Icons.house,
                    color,
                    tooltip: `Bound: ${shortPath(bound)}`,
                    tooltipColor: color,
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
    const tooltip =
        uuid === null
            ? "No house selected"
            : trusted
              ? "This house is trusted"
              : "Trust this house";
    const tooltipColor =
        uuid === null ? COLOR_TEXT_FAINT : trusted ? TRUST_ICON_ON : COLOR_TEXT_DIM;
    return Button({
        style: {
            width: { kind: "px", value: 76 },
            height: { kind: "grow" },
            background: trusted ? COLOR_TOGGLE_ON : COLOR_BUTTON,
            hoverBackground: trusted ? COLOR_TOGGLE_ON_HOVER : COLOR_BUTTON_HOVER,
        },
        disabled: !enabled,
        onClick: () => {
            if (uuid === null) return;
            setHouseTrust(uuid, !trusted);
        },
        tooltip,
        tooltipColor,
        children: [
            Icon({
                name: trusted ? Icons.shieldCheck : Icons.shield,
                color: trusted ? TRUST_ICON_ON : enabled ? COLOR_TEXT_DIM : COLOR_TEXT_FAINT,
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
        tooltip,
        tooltipColor: COLOR_TEXT_DIM,
        children: [
            Icon({
                name: icon,
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

export function HousesView(bodyW: number): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" }, padding: 4 },
        children: () => {
            if (knownHouses().length === 0) return [emptyState()];
            return [housePickerRow(), typeBrowserSection(viewedUuid, bodyW - 8)];
        },
    });
}
