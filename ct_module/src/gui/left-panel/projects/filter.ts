import type { Importable } from "htsw/types";

import { Element } from "../../lib/layout";
import { Container, Scroll } from "../../lib/components";
import { type LinkStatusKey } from "../../cache-status";
import {
    PROJECT_LINK_STATUSES,
    checkboxRow,
    statusFilterRows,
    popoverWidthForLabels,
    FILTER_ROW_HOVER_BG,
} from "../statusFilter";
import { bumpTreeRevision, IMPORTABLE_TYPE_COLORS } from "./rowModel";

type ImportableType = Importable["type"];
const ALL_IMPORTABLE_TYPES: ImportableType[] = [
    "FUNCTION", "EVENT", "REGION", "ITEM", "MENU", "NPC", "TEAM", "GROUP", "COMMAND",
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
    (ALL_IMPORTABLE_TYPES.length + PROJECT_LINK_STATUSES.length) * 20 + 5 + 6
);

export function filterPopoverWidth(): number {
    const labels = (ALL_IMPORTABLE_TYPES as string[]).concat(
        PROJECT_LINK_STATUSES.map((s) => s.label)
    );
    return popoverWidthForLabels(labels);
}

export function filterPopoverContent(): Element {
    return Scroll({
        id: "left-filter-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () => {
            const rows: Element[] = ALL_IMPORTABLE_TYPES.map((t) =>
                checkboxRow(selectedTypes.has(t), () => toggleType(t), Container({
                    style: {
                        width: { kind: "px", value: 6 }, height: { kind: "px", value: 12 },
                        background: IMPORTABLE_TYPE_COLORS[t],
                    },
                    children: [],
                }), t)
            );
            rows.push(Container({
                style: { height: { kind: "px", value: 3 }, background: FILTER_ROW_HOVER_BG },
                children: [],
            }));
            return rows.concat(
                statusFilterRows(PROJECT_LINK_STATUSES, selectedStatuses, toggleStatus)
            );
        },
    });
}
