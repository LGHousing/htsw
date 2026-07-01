/// <reference types="../../../../CTAutocomplete" />

import { Element, SCROLLBAR_WIDTH } from "../../lib/layout";
import {
    Button,
    Col,
    Container,
    Icon,
    Input,
    Row,
    Scroll,
    Text,
} from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import { closeAllPopovers, togglePopover } from "../../lib/popovers";
import { openFileBrowser } from "../../popovers/file-browser";
import {
    getHousingUuid,
    isHouseTrusted,
    isParseInProgress,
    setHouseTrust,
    setImportJsonPath,
} from "../../state";
import {
    ACCENT_SUCCESS,
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    COLOR_TOGGLE_ON,
    COLOR_TOGGLE_ON_HOVER,
} from "../../lib/theme";
import { canonicalPath } from "../../parsing/parses";
import { boundImportJsonPath } from "../../../importCache/houseBindings";
import { houseDisplayName } from "../../../importCache/aliases";
import { addRecent, getRecents } from "../../persistence/recents";
import { normalizeHtswPath } from "../../lib/pathDisplay";
import { ACTIVE_BG, ACTIVE_HOVER_BG, ROW_BG, ROW_HOVER_BG } from "./rowModel";
import { queueSourcePath } from "./source";
import { SORT_FIELDS, isSortDefault, sortPopoverContent } from "./sort";
import { isFilterDefault, filterPopoverContent, FILTER_POPOVER_HEIGHT } from "./filter";
import { searchQuery, setSearchQuery } from "./rows";
import { createStarterProject } from "../../starterProject";
import { isSampleDismissed, setSampleDismissed } from "../../persistence/onboarding";
import { RESULTS_SCROLL_ID, renderRows } from "./tree";

const TRUST_ICON_ON = ACCENT_SUCCESS;

function currentHouseTrustButton(): Element {
    const uuid = getHousingUuid();
    const trusted = uuid !== null && isHouseTrusted(uuid);
    const tooltip =
        uuid === null
            ? "No current house detected"
            : trusted
              ? "Current house is trusted"
              : "Trust current house";
    const tooltipColor =
        uuid === null ? COLOR_TEXT_FAINT : trusted ? TRUST_ICON_ON : COLOR_TEXT_DIM;
    return Button({
        style: {
            width: { kind: "px", value: 76 },
            height: { kind: "grow" },
            background: trusted ? COLOR_TOGGLE_ON : COLOR_BUTTON,
            hoverBackground: trusted ? COLOR_TOGGLE_ON_HOVER : COLOR_BUTTON_HOVER,
        },
        disabled: uuid === null,
        onClick: () => {
            if (uuid === null) return;
            setHouseTrust(uuid, !trusted);
        },
        tooltip,
        tooltipColor,
        children: [
            Icon({
                name: trusted ? Icons.shieldCheck : Icons.shield,
                color: trusted ? TRUST_ICON_ON : uuid === null ? COLOR_TEXT_FAINT : COLOR_TEXT_DIM,
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                },
            }),
            Text({
                text: trusted ? "Trusted" : "Trust",
                color: uuid === null ? COLOR_TEXT_FAINT : COLOR_TEXT,
            }),
        ],
    });
}

function openBrowseModal(): void {
    closeAllPopovers();
    openFileBrowser();
}

function loadRecent(path: string): void {
    queueSourcePath(path);
    setImportJsonPath(path);
    addRecent(path);
    closeAllPopovers();
}

function recentsPopoverContent(): Element {
    return Scroll({
        id: "left-recents-popover-scroll",
        style: { padding: 4, gap: 2 },
        children: () => {
            const rs = getRecents();
            if (rs.length === 0) {
                return [
                    Container({
                        style: { padding: 6 },
                        children: [
                            Text({
                                text: "No recent files",
                                color: 0xff8a92a3 | 0,
                            }),
                        ],
                    }),
                ];
            }
            // Mark the recent that belongs to the house you're standing in,
            // so "open this house's project" is one obvious click.
            const uuid = getHousingUuid();
            const bound = uuid === null ? null : boundImportJsonPath(uuid);
            return rs.map((p) =>
                Container({
                    style: {
                        direction: "row",
                        align: "center",
                        gap: 4,
                        padding: { side: "x", value: 6 },
                        height: { kind: "px", value: 18 },
                        background: ROW_BG,
                        hoverBackground: ROW_HOVER_BG,
                    },
                    onClick: () => loadRecent(p),
                    children: [
                        Text({
                            text: normalizeHtswPath(p),
                            style: { width: { kind: "grow" } },
                        }),
                        bound !== null &&
                            uuid !== null &&
                            canonicalPath(p) === bound &&
                            Icon({
                                name: Icons.house,
                                color: ACCENT_SUCCESS,
                                tooltip: `Bound to ${houseDisplayName(uuid)} (you're here)`,
                                tooltipColor: ACCENT_SUCCESS,
                                style: {
                                    width: { kind: "px", value: 10 },
                                    height: { kind: "px", value: 10 },
                                },
                            }),
                    ],
                })
            );
        },
    });
}

function emptyStateRow(): Element {
    return Container({
        style: { padding: 8, gap: 6 },
        children: () => {
            const out: (Element | false)[] = [
                Text({
                    text: "Click Browse to open an import.json.",
                    style: { width: { kind: "grow" } },
                }),
            ];
            if (!isSampleDismissed()) {
                out.push(
                    Text({
                        text: "New to HTSW? Start from a commented example:",
                        color: COLOR_TEXT_DIM,
                        style: { width: { kind: "grow" } },
                    }),
                    Row({
                        style: { gap: 4, height: { kind: "px", value: 18 } },
                        children: [
                            Button({
                                icon: Icons.sparkles,
                                text: "Create sample project",
                                style: {
                                    width: { kind: "grow" },
                                    height: { kind: "grow" },
                                },
                                onClick: () => createStarterProject(),
                            }),
                            Button({
                                children: [
                                    Icon({
                                        name: Icons.x,
                                        tooltip: "Hide this (restore with /htsw tour)",
                                        tooltipColor: COLOR_TEXT_DIM,
                                        style: {
                                            width: { kind: "px", value: 12 },
                                            height: { kind: "px", value: 12 },
                                        },
                                    }),
                                ],
                                style: {
                                    width: { kind: "px", value: 22 },
                                    height: { kind: "grow" },
                                },
                                onClick: () => setSampleDismissed(),
                            }),
                        ],
                    })
                );
            }
            return out;
        },
    });
}

function loadingRow(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            justify: "center",
            width: { kind: "grow" },
            height: { kind: "px", value: 32 },
            padding: 6,
        },
        children: [
            Text({
                text: "Parsing project…",
                color: COLOR_TEXT_DIM,
            }),
        ],
    });
}

export function ImportablesView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" } },
        children: [
            Row({
                style: { gap: 6, height: { kind: "px", value: 22 }, align: "stretch" },
                children: [
                    Row({
                        style: {
                            gap: 6,
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                        },
                        children: [
                            Button({
                                icon: Icons.search,
                                text: "Browse",
                                style: {
                                    width: { kind: "grow" },
                                    height: { kind: "grow" },
                                },
                                onClick: () => openBrowseModal(),
                            }),
                            Button({
                                icon: Icons.history,
                                text: "Recent",
                                style: {
                                    width: { kind: "px", value: 80 },
                                    height: { kind: "grow" },
                                },
                                onClick: (rect) => {
                                    togglePopover({
                                        key: "left-recents",
                                        anchor: rect,
                                        content: recentsPopoverContent(),
                                        width: 280,
                                        height: Math.min(
                                            180,
                                            getRecents().length * 20 + 12
                                        ),
                                    });
                                },
                            }),
                        ],
                    }),
                    Row({
                        style: { height: { kind: "grow" }, align: "center" },
                        children: () => [currentHouseTrustButton()],
                    }),
                ],
            }),
            Row({
                style: { gap: 6, height: { kind: "px", value: 22 }, align: "stretch" },
                children: [
                    Row({
                        style: {
                            gap: 4,
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            align: "center",
                            padding: { side: "left", value: 4 },
                        },
                        children: [
                            Icon({ name: Icons.search }),
                            Input({
                                id: "left-search",
                                value: () => searchQuery,
                                onChange: (v) => {
                                    setSearchQuery(v);
                                },
                                placeholder: "Search...",
                                style: {
                                    width: { kind: "grow" },
                                    height: { kind: "grow" },
                                },
                            }),
                        ],
                    }),
                    Button({
                        icon: Icons.arrowUpDown,
                        style: {
                            width: { kind: "px", value: 26 },
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
                        icon: Icons.filter,
                        style: {
                            width: { kind: "px", value: 26 },
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
                id: RESULTS_SCROLL_ID,
                style: {
                    gap: 0,
                    height: { kind: "grow" },
                    padding: { side: "right", value: SCROLLBAR_WIDTH + 4 },
                },
                children: () => {
                    // Keep the tree mounted while a load parses: blanking it
                    // here made loading a file collapse and re-expand the
                    // whole panel. The indicator only earns its place when
                    // there is nothing else to show.
                    const rows = renderRows();
                    if (rows.length === 0) {
                        return [isParseInProgress() ? loadingRow() : emptyStateRow()];
                    }
                    return rows;
                },
            }),
        ],
    });
}
