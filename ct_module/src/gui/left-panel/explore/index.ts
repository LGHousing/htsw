/// <reference types="../../../../CTAutocomplete" />

import {
    Element,
    SCROLLBAR_WIDTH,
} from "../../lib/layout";
import { Button, Col, Container, Icon, Input, Row, Scroll, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import { closeAllPopovers, togglePopover } from "../../lib/popovers";
import { openFileBrowser } from "../../popovers/file-browser";
import {
    getImportJsonPath,
    isParseInProgress,
    setImportJsonPath,
} from "../../state";
import { COLOR_TEXT_DIM } from "../../lib/theme";
import { scheduleReparse } from "../../state/reparse";
import { addRecent, getRecents } from "../../state/recents";
import { normalizeHtswPath } from "../../lib/pathDisplay";
import { ACTIVE_BG, ACTIVE_HOVER_BG, ROW_BG, ROW_HOVER_BG } from "./types";
import { queueSourcePath } from "./source";
import { SORT_FIELDS, isSortDefault, sortPopoverContent } from "./sort";
import { isFilterDefault, filterPopoverContent, FILTER_POPOVER_HEIGHT } from "./filter";
import { searchQuery, setSearchQuery } from "./rows";
import { RESULTS_SCROLL_ID, renderRows } from "./tree";

function dirOfPath(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}

function openBrowseModal(): void {
    closeAllPopovers();
    openFileBrowser(dirOfPath(getImportJsonPath()) || ".");
}

function loadRecent(path: string): void {
    queueSourcePath(path);
    setImportJsonPath(path);
    addRecent(path);
    scheduleReparse();
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
            return rs.map((p) =>
                Container({
                    style: {
                        direction: "row",
                        align: "center",
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
                    ],
                })
            );
        },
    });
}

function emptyStateRow(): Element {
    return Container({
        style: { padding: 8 },
        children: [
            Text({
                text: "Click Browse to open an import.json.",
                style: { width: { kind: "grow" } },
            }),
        ],
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

export function ExploreView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" } },
        children: [
            Row({
                style: { gap: 6, height: { kind: "px", value: 22 }, align: "stretch" },
                children: [
                    Button({
                        icon: Icons.search,
                        text: "Browse",
                        style: { width: { kind: "grow" }, height: { kind: "grow" } },
                        onClick: () => openBrowseModal(),
                    }),
                    Button({
                        icon: Icons.history,
                        text: "Recent",
                        style: { width: { kind: "px", value: 80 }, height: { kind: "grow" } },
                        onClick: (rect) => {
                            togglePopover({
                                key: "left-recents",
                                anchor: rect,
                                content: recentsPopoverContent(),
                                width: 280,
                                height: Math.min(180, getRecents().length * 20 + 12),
                            });
                        },
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
                                style: { width: { kind: "grow" }, height: { kind: "grow" } },
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
                    if (isParseInProgress()) return [loadingRow()];
                    const rows = renderRows();
                    if (rows.length === 0) return [emptyStateRow()];
                    return rows;
                },
            }),
        ],
    });
}
