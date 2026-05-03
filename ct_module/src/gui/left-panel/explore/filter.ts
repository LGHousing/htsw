import { Element } from "../../lib/layout";
import { Container, Scroll, Text } from "../../lib/components";
import {
    ALL_TYPES,
    ResultType,
    TYPE_COLORS,
    ACTIVE_BG,
    ACTIVE_HOVER_BG,
    ROW_BG,
    ROW_HOVER_BG,
} from "./types";

const selectedTypes: Set<ResultType> = new Set();

export function isTypeActive(t: ResultType): boolean {
    return selectedTypes.size === 0 || selectedTypes.has(t);
}

export function isFilterDefault(): boolean {
    return selectedTypes.size === 0;
}

function toggleType(t: ResultType): void {
    if (selectedTypes.has(t)) selectedTypes.delete(t);
    else selectedTypes.add(t);
}

export const FILTER_POPOVER_HEIGHT = Math.min(160, ALL_TYPES.length * 20 + 6);

export function filterPopoverContent(): Element {
    return Scroll({
        id: "left-filter-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () =>
            ALL_TYPES.map((t) => {
                const on = selectedTypes.has(t);
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
