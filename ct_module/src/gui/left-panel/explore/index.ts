/// <reference types="../../../../CTAutocomplete" />

import { Element } from "../../layout";
import { Button, Col, Container, Input, Row, Scroll, Text } from "../../components";
import { togglePopover } from "../../popovers";
import {
    Result,
    DUMMY_RESULTS,
    TYPE_COLORS,
    ACTIVE_BG,
    ACTIVE_HOVER_BG,
    ROW_BG,
    ROW_HOVER_BG,
} from "./types";
import {
    SORT_FIELDS,
    isSortDefault,
    sortResults,
    sortPopoverContent,
} from "./sort";
import {
    isTypeActive,
    isFilterDefault,
    filterPopoverContent,
    FILTER_POPOVER_HEIGHT,
} from "./filter";

let searchQuery = "";

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

function resultRow(r: Result): Element {
    return Container({
        style: {
            direction: "row",
            padding: { side: "x", value: 3 },
            gap: 6,
            align: "center",
            height: { kind: "px", value: 18 },
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: () => ChatLib.chat(`&a[htsw] clicked ${r.type}: ${r.name}`),
        children: [
            Container({
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                    background: TYPE_COLORS[r.type],
                },
                children: [],
            }),
            Text({ text: r.name, style: { width: { kind: "grow" } } }),
        ],
    });
}

export function ExploreView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" } },
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
                                height: FILTER_POPOVER_HEIGHT,
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
