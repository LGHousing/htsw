import { Element } from "../../lib/layout";
import { Container, Scroll, Text } from "../../lib/components";
import { Result, ACTIVE_BG, ACTIVE_HOVER_BG, ROW_BG, ROW_HOVER_BG } from "./types";

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
let activeSort: { id: SortFieldId; direction: SortDir } = DEFAULT_SORT;

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
}

export function sortPopoverContent(): Element {
    return Scroll({
        id: "left-sort-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () =>
            SORT_FIELDS.map((f) => {
                const on = activeSort.id === f.id;
                return Container({
                    style: {
                        direction: "row",
                        align: "center",
                        padding: { side: "x", value: 6 },
                        gap: 6,
                        height: { kind: "px", value: 18 },
                        background: on ? ACTIVE_BG : ROW_BG,
                        hoverBackground: on ? ACTIVE_HOVER_BG : ROW_HOVER_BG,
                    },
                    onClick: () => selectSort(f.id),
                    children: [
                        Text({ text: f.label, style: { width: { kind: "grow" } } }),
                        Text({
                            text: on ? `[${activeSort.direction}]` : "",
                        }),
                    ],
                });
            }),
    });
}
