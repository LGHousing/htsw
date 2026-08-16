import type { Importable } from "htsw/types";

import { Element } from "../../lib/layout";
import { Container, Scroll } from "../../lib/components";
import {
    cachedImportableLinkStatus,
    type LinkStatusKey,
} from "../../cache-status";
import {
    PROJECT_LINK_STATUSES,
    optionRow,
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
let filterRevision = 0;

export function getFilterRevision(): number {
    return filterRevision;
}

export type FilterState = { types: string[]; statuses: string[] };

export function getFilterState(): FilterState {
    const types: string[] = [];
    const statuses: string[] = [];
    selectedTypes.forEach((t) => types.push(t));
    selectedStatuses.forEach((s) => statuses.push(s));
    types.sort();
    statuses.sort();
    return { types, statuses };
}

export function setFilterState(next: FilterState): void {
    selectedTypes.clear();
    selectedStatuses.clear();
    for (let i = 0; i < next.types.length; i++) {
        const type = next.types[i] as ImportableType;
        // Ignore unknown names: an importable type removed since the file was
        // written must not resurrect as a filter nothing can satisfy.
        if (ALL_IMPORTABLE_TYPES.indexOf(type) >= 0) selectedTypes.add(type);
    }
    for (let i = 0; i < next.statuses.length; i++) {
        const status = next.statuses[i] as LinkStatusKey;
        for (let j = 0; j < PROJECT_LINK_STATUSES.length; j++) {
            if (PROJECT_LINK_STATUSES[j].key === status) {
                selectedStatuses.add(status);
                break;
            }
        }
    }
    filterRevision++;
    bumpTreeRevision();
}

function isImportableTypeActive(t: ImportableType): boolean {
    return selectedTypes.size === 0 || selectedTypes.has(t);
}
export function isImportableStatusFilterActive(): boolean {
    return selectedStatuses.size > 0;
}
function isLinkStatusActive(key: LinkStatusKey): boolean {
    return selectedStatuses.size === 0 || selectedStatuses.has(key);
}
export function isFilterDefault(): boolean {
    return selectedTypes.size === 0 && selectedStatuses.size === 0;
}
export function importableMatchesFilters(
    imp: Importable,
    parentPath: string,
    query: string
): boolean {
    if (!isImportableTypeActive(imp.type)) return false;
    if (
        isImportableStatusFilterActive() &&
        !isLinkStatusActive(cachedImportableLinkStatus(imp)?.key ?? "unknown")
    )
        return false;
    const q = query.toLowerCase();
    if (q.length === 0 || parentPath.toLowerCase().indexOf(q) >= 0) return true;
    const name = imp.type === "EVENT" ? imp.event : imp.name;
    return name.toLowerCase().indexOf(q) >= 0;
}
export function resetFilters(): void {
    if (selectedTypes.size === 0 && selectedStatuses.size === 0) return;
    selectedTypes.clear();
    selectedStatuses.clear();
    filterRevision++;
    bumpTreeRevision();
}
function toggleType(t: ImportableType): void {
    if (selectedTypes.has(t)) selectedTypes.delete(t);
    else selectedTypes.add(t);
    filterRevision++;
    bumpTreeRevision();
}
function toggleStatus(key: LinkStatusKey): void {
    if (selectedStatuses.has(key)) selectedStatuses.delete(key);
    else selectedStatuses.add(key);
    filterRevision++;
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
                optionRow(
                    selectedTypes.has(t),
                    () => toggleType(t),
                    Container({
                        style: {
                            width: { kind: "px", value: 6 }, height: { kind: "px", value: 12 },
                            background: IMPORTABLE_TYPE_COLORS[t],
                        },
                        children: [],
                    }),
                    t,
                    ""
                )
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
