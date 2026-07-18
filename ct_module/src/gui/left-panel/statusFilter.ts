/// <reference types="../../../CTAutocomplete" />

import { Element, SCROLLBAR_WIDTH } from "../lib/layout";
import { Container, Scroll, Text } from "../lib/components";
import { linkStatusIcon, type LinkStatusKey } from "../cache-status";

// Row colors shared by every filter popover so the Projects (type + status) and
// Houses (status only) bars read as the same control.
export const FILTER_ACTIVE_BG = 0xff2d4d2d | 0;
export const FILTER_ACTIVE_HOVER_BG = 0xff3a5d3a | 0;
const FILTER_ROW_BG = 0xff2d333d | 0;
export const FILTER_ROW_HOVER_BG = 0xff3a4350 | 0;

export type LinkStatusOption = { key: LinkStatusKey; label: string };

export const PROJECT_LINK_STATUSES: LinkStatusOption[] = [
    { key: "matches", label: "Matches house" },
    { key: "differs", label: "Differs from house" },
    { key: "present", label: "In house, not read" },
    { key: "oneSided", label: "Not in house" },
    { key: "unknown", label: "Unknown" },
];

// One row shape for every filter/sort popover: an optional leading marker
// (type chip or status icon; null for sort fields), the label, and a trailing
// state tag ("[x]"/"[ ]" for filters, "[ASC]"/"[DESC]" for sort).
export function optionRow(
    on: boolean,
    onClick: () => void,
    marker: Element | null,
    label: string,
    trailing: string
): Element {
    const children: Element[] = [];
    if (marker !== null) children.push(marker);
    children.push(Text({ text: label, truncate: true, style: { width: { kind: "grow" } } }));
    children.push(Text({ text: trailing }));
    return Container({
        style: {
            direction: "row", align: "center", padding: { side: "x", value: 6 }, gap: 6,
            height: { kind: "px", value: 18 },
            background: on ? FILTER_ACTIVE_BG : FILTER_ROW_BG,
            hoverBackground: on ? FILTER_ACTIVE_HOVER_BG : FILTER_ROW_HOVER_BG,
        },
        onClick,
        children,
    });
}

export function checkboxRow(
    on: boolean,
    onClick: () => void,
    marker: Element | null,
    label: string
): Element {
    return optionRow(on, onClick, marker, label, on ? "[x]" : "[ ]");
}

export function statusFilterRows(
    statuses: LinkStatusOption[],
    selected: Set<LinkStatusKey>,
    toggle: (key: LinkStatusKey) => void
): Element[] {
    return statuses.map((s) =>
        checkboxRow(selected.has(s.key), () => toggle(s.key), linkStatusIcon(s.key, s.label), s.label)
    );
}

// Widest label + the row frame: 6px marker + two 6px gaps + the "[x]" checkbox
// inside the row's 6px side padding, plus the Scroll's 4px padding and reserved
// scrollbar track. Sizing to fit keeps a long label
// from painting under the checkbox.
export function popoverWidthForLabels(labels: string[]): number {
    let maxLabel = 0;
    for (let i = 0; i < labels.length; i++) {
        const w = Renderer.getStringWidth(labels[i]);
        if (w > maxLabel) maxLabel = w;
    }
    const frame = 6 + 6 + 6 + 6 + Renderer.getStringWidth("[x]") + 6 + 6 + 4 + 4 + SCROLLBAR_WIDTH;
    const desired = maxLabel + frame;
    return desired < 140 ? 140 : desired;
}

export function statusFilterPopoverHeight(statuses: LinkStatusOption[]): number {
    return statuses.length * 20 + 6;
}

export function statusFilterPopoverWidth(statuses: LinkStatusOption[]): number {
    return popoverWidthForLabels(statuses.map((s) => s.label));
}

export function statusFilterPopoverContent(
    statuses: LinkStatusOption[],
    selected: Set<LinkStatusKey>,
    toggle: (key: LinkStatusKey) => void
): Element {
    return Scroll({
        id: "status-filter-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () => statusFilterRows(statuses, selected, toggle),
    });
}
