import type { Importable } from "htsw/types";

import { Element } from "../../lib/layout";
import { Container, Scroll, Text } from "../../lib/components";
import { linkStatusIcon, type LinkStatusKey } from "../../cache-status";
import {
    bumpTreeRevision,
    IMPORTABLE_TYPE_COLORS,
    ACTIVE_BG,
    ACTIVE_HOVER_BG,
    ROW_BG,
    ROW_HOVER_BG,
} from "./rowModel";

type ImportableType = Importable["type"];
const ALL_IMPORTABLE_TYPES: ImportableType[] = [
    "FUNCTION", "EVENT", "REGION", "ITEM", "MENU", "NPC", "TEAM", "GROUP", "COMMAND",
];
const ALL_LINK_STATUSES: { key: LinkStatusKey; label: string }[] = [
    { key: "matches", label: "Matches house" },
    { key: "differs", label: "Differs from house" },
    { key: "present", label: "In house, not compared" },
    { key: "oneSided", label: "Not in house" },
    { key: "unknown", label: "Unknown" },
];
const selectedTypes: Set<ImportableType> = new Set();
const selectedStatuses: Set<LinkStatusKey> = new Set();

export function isImportableTypeActive(t: ImportableType): boolean {
    return selectedTypes.size === 0 || selectedTypes.has(t);
}
export function isImportableStatusFilterActive(): boolean {
    return selectedStatuses.size > 0;
}
export function isLinkStatusActive(key: LinkStatusKey): boolean {
    return selectedStatuses.size === 0 || selectedStatuses.has(key);
}
export function isFilterDefault(): boolean {
    return selectedTypes.size === 0 && selectedStatuses.size === 0;
}
export function resetFilters(): void {
    if (selectedTypes.size === 0 && selectedStatuses.size === 0) return;
    selectedTypes.clear();
    selectedStatuses.clear();
    bumpTreeRevision();
}
function toggleType(t: ImportableType): void {
    if (selectedTypes.has(t)) selectedTypes.delete(t);
    else selectedTypes.add(t);
    bumpTreeRevision();
}
function toggleStatus(key: LinkStatusKey): void {
    if (selectedStatuses.has(key)) selectedStatuses.delete(key);
    else selectedStatuses.add(key);
    bumpTreeRevision();
}

export const FILTER_POPOVER_HEIGHT = Math.min(
    320,
    (ALL_IMPORTABLE_TYPES.length + ALL_LINK_STATUSES.length) * 20 + 5 + 6
);

function filterRow(on: boolean, onClick: () => void, marker: Element, label: string): Element {
    return Container({
        style: {
            direction: "row", align: "center", padding: { side: "x", value: 6 }, gap: 6,
            height: { kind: "px", value: 18 }, background: on ? ACTIVE_BG : ROW_BG,
            hoverBackground: on ? ACTIVE_HOVER_BG : ROW_HOVER_BG,
        },
        onClick,
        children: [
            marker,
            Text({ text: label, style: { width: { kind: "grow" } } }),
            Text({ text: on ? "[x]" : "[ ]" }),
        ],
    });
}

export function filterPopoverContent(): Element {
    return Scroll({
        id: "left-filter-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () => {
            const rows: Element[] = ALL_IMPORTABLE_TYPES.map((t) =>
                filterRow(selectedTypes.has(t), () => toggleType(t), Container({
                    style: {
                        width: { kind: "px", value: 6 }, height: { kind: "px", value: 12 },
                        background: IMPORTABLE_TYPE_COLORS[t],
                    },
                    children: [],
                }), t)
            );
            rows.push(Container({
                style: { height: { kind: "px", value: 3 }, background: ROW_HOVER_BG },
                children: [],
            }));
            for (let i = 0; i < ALL_LINK_STATUSES.length; i++) {
                const status = ALL_LINK_STATUSES[i];
                rows.push(filterRow(
                    selectedStatuses.has(status.key),
                    () => toggleStatus(status.key),
                    linkStatusIcon(status.key, status.label),
                    status.label
                ));
            }
            return rows;
        },
    });
}
