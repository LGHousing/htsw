/// <reference types="../../../CTAutocomplete" />

import { Element } from "../layout";
import { Button, Col, Container, Input, Row, Scroll, Text } from "../components";
import { openPopover } from "../popovers";

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
    item:   0xffe5bc4b | 0,
};

let searchQuery = "";
let selectedTypes: { [k: string]: boolean } = {};

function isTypeActive(t: ResultType): boolean {
    let anySelected = false;
    for (const k in selectedTypes) if (selectedTypes[k]) { anySelected = true; break; }
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
    return out;
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
                style: { width: { kind: "px", value: 6 }, height: { kind: "px", value: 12 }, background: TYPE_COLORS[r.type] },
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
        children: () => ALL_TYPES.map(t => {
            const on = selectedTypes[t] === true;
            return Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: { side: "x", value: 6 },
                    gap: 6,
                    height: { kind: "px", value: 18 },
                    background: on ? (0xff2d4d2d | 0) : (0xff2d333d | 0),
                    hoverBackground: on ? (0xff3a5d3a | 0) : (0xff3a4350 | 0),
                },
                onClick: () => toggleType(t),
                children: [
                    Container({
                        style: { width: { kind: "px", value: 6 }, height: { kind: "px", value: 12 }, background: TYPE_COLORS[t] },
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
                        onChange: v => { searchQuery = v; },
                        placeholder: "Search...",
                        style: { width: { kind: "grow" }, height: { kind: "grow" } },
                    }),
                    Button({
                        text: "Filter",
                        style: { width: { kind: "px", value: 48 }, height: { kind: "grow" } },
                        onClick: (rect) => {
                            openPopover({
                                anchor: rect,
                                content: filterPopoverContent(),
                                width: 140,
                                height: Math.min(160, ALL_TYPES.length * 20 + 10),
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
