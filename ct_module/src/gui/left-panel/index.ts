/// <reference types="../../../CTAutocomplete" />

import { Element } from "../layout";
import { Button, Col, Container, Input, Row, Scroll, Text } from "../components";
import { togglePopover } from "../popovers";

export type ResultType = "import" | "script" | "item";
export type Result = { type: ResultType; name: string };

const ALL_TYPES: ResultType[] = ["import", "script", "item"];

const DUMMY_RESULTS: Result[] = [
    { type: "import", name: "spawn_function" },
    { type: "import", name: "lobby_event" },
    { type: "script", name: "checkpoint_handler" },
    { type: "script", name: "scoreboard_update" },
    { type: "item", name: "starter_sword" },
    { type: "item", name: "compass" },
    { type: "import", name: "main_region" },
    { type: "script", name: "weather_cycle" },
    { type: "item", name: "potion_speed" },
    { type: "item", name: "ender_pearl" },
    { type: "import", name: "death_event" },
    { type: "script", name: "respawn_logic" },
    { type: "import", name: "join_event" },
    { type: "item", name: "leather_helmet" },
    { type: "script", name: "boss_phase_1" },
    { type: "script", name: "boss_phase_2" },
    { type: "import", name: "shop_keeper" },
];

const TYPE_COLORS: { [k: string]: number } = {
    import: 0xff67a7e8 | 0,
    script: 0xff62d26f | 0,
    item: 0xffe5bc4b | 0,
};

let searchQuery = "";
let selectedTypes: { [k: string]: boolean } = {};

type SortDir = "ASC" | "DSC";
type SortFieldId = "alphabetical" | "type";

type SortField = {
    id: SortFieldId;
    label: string;
    precedence: number;
    fallbackDir: SortDir;
    compare: (a: Result, b: Result) => number;
};

const SORT_FIELDS: SortField[] = [
    {
        id: "alphabetical",
        label: "Alphabetically",
        precedence: 0,
        fallbackDir: "ASC",
        compare: (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    },
    {
        id: "type",
        label: "By type",
        precedence: 1,
        fallbackDir: "ASC",
        compare: (a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
    },
];

const DEFAULT_SORT: { id: SortFieldId; direction: SortDir } = {
    id: "alphabetical",
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

function sortResults(rs: Result[]): Result[] {
    const primary = getSortField(activeSort.id);
    // fallbacks: every other field, ordered by precedence (higher first)
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

function isSortDefault(): boolean {
    return (
        activeSort.id === DEFAULT_SORT.id &&
        activeSort.direction === DEFAULT_SORT.direction
    );
}

function isFilterDefault(): boolean {
    for (const k in selectedTypes) if (selectedTypes[k]) return false;
    return true;
}

const ACTIVE_BG = 0xff2d4d2d | 0;
const ACTIVE_HOVER_BG = 0xff3a5d3a | 0;

function selectSort(id: SortFieldId): void {
    if (activeSort.id === id) {
        activeSort.direction = activeSort.direction === "ASC" ? "DSC" : "ASC";
    } else {
        activeSort = { id, direction: getSortField(id).fallbackDir };
    }
}

function isTypeActive(t: ResultType): boolean {
    let anySelected = false;
    for (const k in selectedTypes)
        if (selectedTypes[k]) {
            anySelected = true;
            break;
        }
    if (!anySelected) return true; // none selected => all active
    return selectedTypes[t] === true;
}

function toggleType(t: ResultType): void {
    selectedTypes[t] = !selectedTypes[t];
}

function filteredResults(): Result[] {
    const q = searchQuery.toLowerCase();
    const out: Result[] = [];
    for (let i = 0; i < DUMMY_RESULTS.length; i++) {
        const r = DUMMY_RESULTS[i];
        if (!isTypeActive(r.type)) continue;
        if (q.length > 0 && r.name.toLowerCase().indexOf(q) < 0) continue;
        out.push(r);
    }
    return sortResults(out);
}

function sortPopoverContent(): Element {
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
                        background: on ? 0xff2d4d2d | 0 : 0xff2d333d | 0,
                        hoverBackground: on ? 0xff3a5d3a | 0 : 0xff3a4350 | 0,
                    },
                    onClick: () => selectSort(f.id),
                    children: [
                        Text({ text: f.label, style: { width: { kind: "grow" } } }),
                        Text({
                            text: on ? `[${activeSort.direction}]` : "",
                            color: 0xff888888 | 0,
                        }),
                    ],
                });
            }),
    });
}

function resultRow(r: Result): Element {
    return Container({
        style: {
            direction: "row",
            padding: { side: "x", value: 6 },
            gap: 6,
            align: "center",
            height: { kind: "px", value: 18 },
            background: 0xff2d333d | 0,
            hoverBackground: 0xff3a4350 | 0,
        },
        onClick: () => ChatLib.chat(`&a[htsw] clicked ${r.type}: ${r.name}`),
        children: [
            // type badge: small colored swatch
            Container({
                style: {
                    width: { kind: "px", value: 6 },
                    height: { kind: "px", value: 12 },
                    background: TYPE_COLORS[r.type],
                },
                children: [],
            }),
            Text({ text: r.name, style: { width: { kind: "grow" } } }),
            Text({ text: r.type, color: 0xff888888 | 0 }),
        ],
    });
}

function filterPopoverContent(): Element {
    return Scroll({
        id: "left-filter-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () =>
            ALL_TYPES.map((t) => {
                const on = selectedTypes[t] === true;
                return Container({
                    style: {
                        direction: "row",
                        align: "center",
                        padding: { side: "x", value: 6 },
                        gap: 6,
                        height: { kind: "px", value: 18 },
                        background: on ? 0xff2d4d2d | 0 : 0xff2d333d | 0,
                        hoverBackground: on ? 0xff3a5d3a | 0 : 0xff3a4350 | 0,
                    },
                    onClick: () => toggleType(t),
                    children: [
                        Container({
                            style: {
                                width: { kind: "px", value: 6 },
                                height: { kind: "px", value: 12 },
                                background: TYPE_COLORS[t],
                            },
                            children: [],
                        }),
                        Text({ text: t, style: { width: { kind: "grow" } } }),
                        Text({ text: on ? "[x]" : "[ ]" }),
                    ],
                });
            }),
    });
}

export function LeftPanel(): Element {
    return Col({
        style: { padding: 6, gap: 6 },
        children: [
            Row({
                style: { gap: 6, height: { kind: "px", value: 22 }, align: "stretch" },
                children: [
                    Input({
                        id: "left-search",
                        value: () => searchQuery,
                        onChange: (v) => {
                            searchQuery = v;
                        },
                        placeholder: "Search...",
                        style: { width: { kind: "grow" }, height: { kind: "grow" } },
                    }),
                    Button({
                        text: "Sort",
                        style: {
                            width: { kind: "px", value: 48 },
                            height: { kind: "grow" },
                            background: () => (isSortDefault() ? undefined : ACTIVE_BG),
                            hoverBackground: () =>
                                isSortDefault() ? undefined : ACTIVE_HOVER_BG,
                        },
                        onClick: (rect) => {
                            togglePopover({
                                key: "left-sort",
                                anchor: rect,
                                content: sortPopoverContent(),
                                width: 140,
                                height: SORT_FIELDS.length * 20 + 6,
                            });
                        },
                    }),
                    Button({
                        text: "Filter",
                        style: {
                            width: { kind: "px", value: 48 },
                            height: { kind: "grow" },
                            background: () => (isFilterDefault() ? undefined : ACTIVE_BG),
                            hoverBackground: () =>
                                isFilterDefault() ? undefined : ACTIVE_HOVER_BG,
                        },
                        onClick: (rect) => {
                            togglePopover({
                                key: "left-filter",
                                anchor: rect,
                                content: filterPopoverContent(),
                                width: 140,
                                // padding(4+4) + n rows of 18 + (n-1) gaps of 2 = 20n + 6
                                height: Math.min(160, ALL_TYPES.length * 20 + 6),
                            });
                        },
                    }),
                ],
            }),
            Scroll({
                id: "left-results-scroll",
                style: { gap: 2, height: { kind: "grow" } },
                children: () => filteredResults().map(resultRow),
            }),
        ],
    });
}
