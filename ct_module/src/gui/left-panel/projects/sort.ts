import { Element } from "../../lib/layout";
import { Scroll } from "../../lib/components";
import { optionRow } from "../statusFilter";
import { Result, bumpTreeRevision } from "./rowModel";

type SortDir = "ASC" | "DESC";
type SortFieldId = "type" | "alphabetical";

type SortField = {
    id: SortFieldId;
    label: string;
    precedence: number;
    fallbackDir: SortDir;
    compare: (a: Result, b: Result) => number;
};

export const SORT_FIELDS: SortField[] = [
    {
        id: "type",
        label: "By type",
        precedence: 1,
        fallbackDir: "ASC",
        compare: (a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
    },
    {
        id: "alphabetical",
        label: "Alphabetically",
        precedence: 0,
        fallbackDir: "ASC",
        compare: (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    },
];

const DEFAULT_SORT: { id: SortFieldId; direction: SortDir } = {
    id: "type",
    direction: "ASC",
};
// Copied, not aliased: `selectSort` mutates `activeSort.direction` in place,
// which through a shared reference also rewrote DEFAULT_SORT — leaving
// `isSortDefault` comparing the object to itself and always reporting true.
let activeSort: { id: SortFieldId; direction: SortDir } = {
    id: DEFAULT_SORT.id,
    direction: DEFAULT_SORT.direction,
};

export type SortState = { id: SortFieldId; direction: SortDir };

export function getActiveSort(): SortState {
    return { id: activeSort.id, direction: activeSort.direction };
}

export function setActiveSort(next: SortState): void {
    if (activeSort.id === next.id && activeSort.direction === next.direction) return;
    activeSort = { id: next.id, direction: next.direction };
    bumpTreeRevision();
}

export function isSortFieldId(value: unknown): value is SortFieldId {
    return value === "type" || value === "alphabetical";
}

export function isSortDir(value: unknown): value is SortDir {
    return value === "ASC" || value === "DESC";
}

function getSortField(id: SortFieldId): SortField {
    for (let i = 0; i < SORT_FIELDS.length; i++)
        if (SORT_FIELDS[i].id === id) return SORT_FIELDS[i];
    return SORT_FIELDS[0];
}

function applyDir(cmp: number, dir: SortDir): number {
    return dir === "ASC" ? cmp : -cmp;
}

export function sortResults(rs: Result[]): Result[] {
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

export function isSortDefault(): boolean {
    return (
        activeSort.id === DEFAULT_SORT.id &&
        activeSort.direction === DEFAULT_SORT.direction
    );
}

function selectSort(id: SortFieldId): void {
    if (activeSort.id === id) {
        activeSort.direction = activeSort.direction === "ASC" ? "DESC" : "ASC";
    } else {
        activeSort = { id, direction: getSortField(id).fallbackDir };
    }
    bumpTreeRevision();
}

export function sortPopoverContent(): Element {
    return Scroll({
        id: "left-sort-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () =>
            SORT_FIELDS.map((f) => {
                const on = activeSort.id === f.id;
                return optionRow(
                    on,
                    () => selectSort(f.id),
                    null,
                    f.label,
                    on ? `[${activeSort.direction}]` : ""
                );
            }),
    });
}
