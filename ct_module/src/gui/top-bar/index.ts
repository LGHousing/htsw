/// <reference types="../../../CTAutocomplete" />

import { Element, Rect } from "../lib/layout";
import { Button, Container, Input, Row, Scroll, Text } from "../lib/components";
import { getImportJsonPath, setImportJsonPath } from "../state";
import { reparseImportJson, scheduleReparse } from "../state/reparse";
import { openAddImportablePopover } from "../popovers/add-importable";
import { openFileBrowser } from "../popovers/file-browser";
import { getRecents } from "../state/recents";
import { closeAllPopovers, togglePopover } from "../lib/popovers";
import { normalizeHtswPath } from "../lib/pathDisplay";
import {
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_PANEL,
    COLOR_PANEL_BORDER,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_TEXT_DIM,
    GLYPH_CHEVRON_DOWN,
    SIZE_ROW_H,
} from "../lib/theme";

function dirOf(path: string): string {
    const norm = path.replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}

function loadRecent(path: string): void {
    setImportJsonPath(path);
    scheduleReparse();
    closeAllPopovers();
    ChatLib.chat(`&a[htsw] Loaded ${path}`);
}

function recentsPopoverContent(): Element {
    const items = getRecents();
    if (items.length === 0) {
        return Container({
            style: { padding: 8 },
            children: [
                Text({
                    text: "No recent paths yet — pick one in Browse.",
                    color: COLOR_TEXT_DIM,
                }),
            ],
        });
    }
    return Scroll({
        id: "topbar-recents-scroll",
        style: { height: { kind: "grow" } },
        children: items.map((path) =>
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: { side: "x", value: 8 },
                    gap: 6,
                    height: { kind: "px", value: SIZE_ROW_H },
                    background: COLOR_ROW,
                    hoverBackground: COLOR_ROW_HOVER,
                },
                onClick: () => loadRecent(path),
                children: [
                    Text({
                        text: path,
                        style: { width: { kind: "grow" } },
                    }),
                ],
            })
        ),
    });
}

export function TopBar(): Element {
    return Row({
        style: {
            background: COLOR_PANEL,
            padding: 4,
            gap: 4,
            width: { kind: "grow" },
            height: { kind: "grow" },
            align: "center",
        },
        children: [
            // Path input + chevron-recents button glued together to look like a single field.
            Container({
                style: {
                    direction: "row",
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    gap: 0,
                    align: "stretch",
                    background: COLOR_PANEL_BORDER,
                },
                children: [
                    Input({
                        id: "topbar-import-path",
                        value: () => normalizeHtswPath(getImportJsonPath()),
                        onChange: (v) => {
                            setImportJsonPath(v);
                            scheduleReparse();
                        },
                        placeholder: "import.json path…",
                        style: { width: { kind: "grow" } },
                    }),
                    Button({
                        text: GLYPH_CHEVRON_DOWN,
                        style: {
                            width: { kind: "px", value: 18 },
                            height: { kind: "grow" },
                        },
                        onClick: (rect: Rect) => {
                            togglePopover({
                                key: "topbar-recents",
                                anchor: rect,
                                content: recentsPopoverContent(),
                                width: 320,
                                height: 160,
                            });
                        },
                    }),
                ],
            }),
            Button({
                text: "Browse",
                style: {
                    width: { kind: "px", value: 56 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON_PRIMARY,
                    hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                },
                onClick: () => openFileBrowser(dirOf(getImportJsonPath())),
            }),
            Button({
                text: "Add Importable",
                style: {
                    width: { kind: "px", value: 96 },
                    height: { kind: "grow" },
                },
                onClick: (rect: Rect) => openAddImportablePopover(rect),
            }),
            // Refresh: force-reparse the current path. Useful when the
            // file changed on disk and the mtime-watch hasn't fired yet.
            Button({
                text: "↻",
                style: {
                    width: { kind: "px", value: 18 },
                    height: { kind: "grow" },
                },
                onClick: () => {
                    reparseImportJson();
                    ChatLib.chat("&7[htsw] reparsed");
                },
            }),
        ],
    });
}
