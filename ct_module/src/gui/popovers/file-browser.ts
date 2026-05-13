/// <reference types="../../../CTAutocomplete" />

import { Child, Element, Rect } from "../lib/layout";
import { Button, Col, Container, Input, Row, Scroll, Text } from "../lib/components";
import { closeAllPopovers, openPopover } from "../lib/popovers";
import { openMenu } from "../lib/menu";
import { openRenameFilePopover } from "./rename-file";
import { showInExplorer } from "../../utils/osShell";
import {
    ACCENT_INFO,
    ACCENT_SUCCESS,
    ACCENT_WARN,
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_DIVIDER,
    COLOR_INPUT_BG,
    COLOR_PANEL_RAISED,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_ROW_SELECTED,
    COLOR_ROW_SELECTED_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    GLYPH_FOLDER,
    GLYPH_HTSL,
    GLYPH_JSON,
    GLYPH_SNBT,
    GLYPH_X,
    SIZE_ROW_H,
} from "../lib/theme";
import { setImportJsonPath } from "../state";
import { scheduleReparse } from "../state/reparse";
import { addRecent } from "../state/recents";
import { normalizeHtswPath } from "../lib/pathDisplay";
import { queueSourcePath } from "../left-panel/explore/source";
import { javaType } from "../lib/java";

type Entry = {
    name: string;
    fullPath: string;
    isDir: boolean;
    /** lower-cased extension (e.g. "json", "htsl") or "" for dirs / extensionless files. */
    ext: string;
};

let cwd: string = "./htsw/imports";
// Mirror of the path-bar input. Decoupled from `cwd` so typing/pasting a
// path doesn't navigate or normalize until the user commits (Enter / Go).
// All non-typed cwd writes route through `setCwd`, which keeps the draft
// in sync so the bar always shows the actual current directory.
let pathDraft: string = cwd;
let filter = "";
// Selected import.json in the current directory listing. Only set when the
// user single-clicks a *.json/import.json row — drives the Load button label
// and active state. Cleared on directory change so a stale selection from a
// previous folder can't be loaded.
let selectedImportPath: string | null = null;
let selectedImportName: string | null = null;

function setCwd(next: string): void {
    cwd = normalizeHtswPath(next);
    pathDraft = cwd;
    selectedImportPath = null;
    selectedImportName = null;
}

function dirExists(path: string): boolean {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        const p = Paths.get(String(path));
        return Files.exists(p) && Files.isDirectory(p);
    } catch (_e) {
        return false;
    }
}

/** Walk up parents until an existing directory is found, falling back to ".". */
function resolveExistingDir(start: string): string {
    let cur = start.replace(/\\/g, "/");
    for (let i = 0; i < 10 && cur !== "" && cur !== "." && cur !== "/"; i++) {
        if (dirExists(cur)) return normalizeHtswPath(cur);
        const slash = cur.lastIndexOf("/");
        if (slash <= 0) break;
        cur = cur.substring(0, slash);
    }
    return ".";
}

function listDir(dir: string): Entry[] {
    const Files = javaType("java.nio.file.Files");
    const Paths = javaType("java.nio.file.Paths");
    const out: Entry[] = [];
    let p: any;
    try {
        p = Paths.get(String(dir));
    } catch (_e) {
        return out;
    }
    let stream: any;
    try {
        stream = Files.newDirectoryStream(p);
    } catch (_e) {
        return out;
    }
    try {
        const it = stream.iterator();
        while (true) {
            let entry: any;
            try {
                if (!it.hasNext()) break;
                entry = it.next();
            } catch (_e) {
                break;
            }
            try {
                const name = String(entry.getFileName().toString());
                const isDir = Files.isDirectory(entry);
                const dot = name.lastIndexOf(".");
                const ext = dot > 0 ? name.substring(dot + 1).toLowerCase() : "";
                const raw = String(entry.toString());
                out.push({
                    name,
                    fullPath: normalizeHtswPath(raw),
                    isDir,
                    ext,
                });
            } catch (_e) {
                // skip unreadable entry
            }
        }
    } finally {
        try {
            stream.close();
        } catch (_e) {
            // ignore
        }
    }
    out.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    return out;
}

function parentOf(dir: string): string {
    const norm = dir.replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return normalizeHtswPath(norm);
    return normalizeHtswPath(norm.substring(0, slash));
}

function isImportJsonEntry(entry: Entry): boolean {
    if (entry.isDir) return false;
    return entry.name.toLowerCase() === "import.json" || entry.ext === "json";
}

function selectImport(entry: Entry): void {
    selectedImportPath = entry.fullPath;
    selectedImportName = entry.name;
}

function navigateInto(entry: Entry): void {
    if (entry.isDir) {
        setCwd(entry.fullPath);
    } else if (isImportJsonEntry(entry)) {
        loadAsImport(entry.fullPath);
    }
}

function loadAsImport(path: string): void {
    queueSourcePath(path);
    setImportJsonPath(path);
    addRecent(path);
    scheduleReparse();
    closeAllPopovers();
    ChatLib.chat(`&a[htsw] Loaded ${path}`);
}

/**
 * Resolve whatever the user has typed/pasted into the path bar. Called on
 * Enter (Input.onSubmit) and the Go button. Directory → navigate. Json
 * file → load. Other file → jump to its parent so the user can see it
 * highlighted in the listing. Non-existent → fall back to the nearest
 * existing ancestor (same fallback the browser uses on initial open).
 */
function commitPathDraft(): void {
    const raw = pathDraft.trim();
    if (raw.length === 0) return;
    const normalized = normalizeHtswPath(raw);
    const Paths = javaType("java.nio.file.Paths");
    const Files = javaType("java.nio.file.Files");
    let p: any;
    try {
        p = Paths.get(String(normalized));
    } catch (_e) {
        ChatLib.chat(`&c[htsw] Invalid path: ${normalized}`);
        return;
    }
    let exists = false;
    try {
        exists = Files.exists(p);
    } catch (_e) {
        exists = false;
    }
    if (exists) {
        let isDir = false;
        try {
            isDir = Files.isDirectory(p);
        } catch (_e) {
            isDir = false;
        }
        if (isDir) {
            setCwd(normalized);
            return;
        }
        const fnObj = p.getFileName();
        if (fnObj === null) {
            setCwd(normalized);
            return;
        }
        const fname = String(fnObj.toString()).toLowerCase();
        const isJson =
            fname.length >= 5 &&
            fname.lastIndexOf(".json") === fname.length - 5;
        if (isJson) {
            loadAsImport(normalized);
            return;
        }
        const parent = p.getParent();
        if (parent !== null) {
            setCwd(String(parent.toString()).split("\\").join("/"));
            ChatLib.chat(`&7[htsw] ${fname} is not an import.json — jumped to its folder`);
            return;
        }
        ChatLib.chat(`&c[htsw] Cannot open ${fname}`);
        return;
    }
    const fallback = resolveExistingDir(normalized);
    setCwd(fallback);
    ChatLib.chat(`&c[htsw] Path not found, jumped to ${fallback}`);
}

function openInOS(): void {
    try {
        const Desktop = javaType("java.awt.Desktop");
        const FileClass = javaType("java.io.File");
        Desktop.getDesktop().open(new FileClass(String(cwd)));
    } catch (err) {
        ChatLib.chat(`&c[htsw] Open in OS failed: ${err}`);
    }
}

function newFolder(): void {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        let i = 1;
        while (true) {
            const candidate = `${cwd}/new-folder${i === 1 ? "" : `-${i}`}`;
            const p = Paths.get(String(candidate));
            if (!Files.exists(p)) {
                Files.createDirectories(p);
                ChatLib.chat(`&a[htsw] Created ${candidate}`);
                return;
            }
            i++;
            if (i > 100) return;
        }
    } catch (err) {
        ChatLib.chat(`&c[htsw] New folder failed: ${err}`);
    }
}

function newImportJson(): void {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        const target = `${cwd}/import.json`;
        const p = Paths.get(String(target));
        if (Files.exists(p)) {
            ChatLib.chat("&c[htsw] import.json already exists here");
            loadAsImport(target);
            return;
        }
        FileLib.write(target, "{\n}\n", true);
        ChatLib.chat(`&a[htsw] Created ${target}`);
        loadAsImport(target);
    } catch (err) {
        ChatLib.chat(`&c[htsw] Init import.json failed: ${err}`);
    }
}

function iconFor(e: Entry): string {
    if (e.isDir) return GLYPH_FOLDER;
    if (e.name.toLowerCase() === "import.json") return GLYPH_JSON;
    if (e.ext === "json") return GLYPH_JSON;
    if (e.ext === "htsl") return GLYPH_HTSL;
    if (e.ext === "snbt") return GLYPH_SNBT;
    return "·";
}

function iconColorFor(e: Entry): number {
    if (e.isDir) return ACCENT_INFO;
    if (e.name.toLowerCase() === "import.json" || e.ext === "json") return ACCENT_SUCCESS;
    if (e.ext === "htsl") return ACCENT_INFO;
    if (e.ext === "snbt") return ACCENT_WARN;
    return COLOR_TEXT_DIM;
}

function fileRow(entry: Entry): Element {
    const isJson = isImportJsonEntry(entry);
    const loadable = entry.isDir || isJson;
    const isSelected =
        isJson && selectedImportPath !== null && selectedImportPath === entry.fullPath;
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 8 },
            gap: 8,
            height: { kind: "px", value: SIZE_ROW_H },
            background: isSelected ? COLOR_ROW_SELECTED : COLOR_ROW,
            hoverBackground: isSelected ? COLOR_ROW_SELECTED_HOVER : COLOR_ROW_HOVER,
        },
        onClick: (_rect, info) => {
            // Right-click on any entry → context menu (Rename / Show in
            // explorer). Doesn't gate on file kind so the user can rename
            // directories and non-.json files too.
            if (info.button === 1) {
                openMenu(
                    info.x,
                    info.y,
                    [
                        {
                            label: "Rename",
                            onClick: () => {
                                openRenameFilePopover(
                                    { x: 0, y: 0, w: 0, h: 0 },
                                    entry.fullPath
                                );
                            },
                        },
                        {
                            label: "Show in explorer",
                            onClick: () => showInExplorer(entry.fullPath),
                        },
                    ],
                    { keepUnderlying: true }
                );
                return;
            }
            // Dirs: ignore single-click (acts as preview only); double-click navigates.
            // import.json files: single-click selects (lights up the Load button); double
            // -click loads. Other files: ignored entirely. All double-click work happens
            // here via isDoubleClickSecond — no separate onDoubleClick handler so chat
            // messages and loadAsImport don't fire twice.
            if (entry.isDir) {
                if (info.isDoubleClickSecond) navigateInto(entry);
                return;
            }
            if (!isJson) return;
            if (info.isDoubleClickSecond) navigateInto(entry);
            else selectImport(entry);
        },
        children: [
            Text({
                text: iconFor(entry),
                color: iconColorFor(entry),
                style: { width: { kind: "px", value: 14 } },
            }),
            Text({
                text: entry.name,
                color: loadable ? COLOR_TEXT : COLOR_TEXT_DIM,
                style: { width: { kind: "grow" } },
            }),
            Text({
                text: entry.isDir ? "dir" : entry.ext,
                color: COLOR_TEXT_DIM,
            }),
        ],
    });
}

function header(): Element {
    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 }, align: "center" },
        children: [
            Text({
                text: "Browser",
                color: ACCENT_WARN,
                style: { width: { kind: "px", value: 60 } },
            }),
            Button({
                text: "Up",
                style: { width: { kind: "px", value: 36 }, height: { kind: "grow" } },
                onClick: () => {
                    setCwd(parentOf(cwd));
                },
            }),
            Button({
                text: "Open in OS",
                style: { width: { kind: "px", value: 80 }, height: { kind: "grow" } },
                onClick: () => openInOS(),
            }),
            Button({
                text: "New Folder",
                style: { width: { kind: "px", value: 80 }, height: { kind: "grow" } },
                onClick: () => newFolder(),
            }),
            Button({
                text: "Init import.json",
                style: { width: { kind: "px", value: 110 }, height: { kind: "grow" } },
                onClick: () => newImportJson(),
            }),
            Container({
                style: { width: { kind: "grow" } },
                children: [],
            }),
            Button({
                text: `${GLYPH_X} Close`,
                style: {
                    width: { kind: "px", value: 60 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => closeAllPopovers(),
            }),
        ],
    });
}

function pathBar(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 6 },
            gap: 6,
            height: { kind: "px", value: 22 },
            background: COLOR_INPUT_BG,
        },
        children: [
            Text({
                text: "path",
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "px", value: 40 } },
            }),
            Input({
                id: "file-browser-path",
                value: () => pathDraft,
                onChange: (v) => {
                    pathDraft = v;
                },
                onSubmit: () => commitPathDraft(),
                placeholder: "paste a path or import.json…",
                style: { width: { kind: "grow" } },
            }),
            Button({
                text: "Go",
                style: { width: { kind: "px", value: 30 }, height: { kind: "grow" } },
                onClick: () => commitPathDraft(),
            }),
        ],
    });
}

function searchBar(): Element {
    return Row({
        style: { gap: 6, height: { kind: "px", value: 20 }, align: "center" },
        children: [
            Input({
                id: "file-browser-filter",
                value: () => filter,
                onChange: (v) => { filter = v; },
                placeholder: "Filter files…",
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

function listBody(): Element {
    return Scroll({
        id: "file-browser-list",
        style: { gap: 1, height: { kind: "grow" }, background: COLOR_PANEL_RAISED },
        children: () => {
            const all = listDir(cwd);
            const q = filter.toLowerCase();
            const filtered =
                q.length === 0
                    ? all
                    : all.filter((e) => e.name.toLowerCase().indexOf(q) >= 0);
            if (filtered.length === 0) {
                return [
                    Container({
                        style: { padding: 8 },
                        children: [
                            Text({
                                text: "(empty directory)",
                                color: COLOR_TEXT_DIM,
                            }),
                        ],
                    }),
                ];
            }
            const out: Child[] = [];
            for (let i = 0; i < filtered.length; i++) out.push(fileRow(filtered[i]));
            return out;
        },
    });
}

function loadButton(): Element {
    return Row({
        style: { gap: 6, height: { kind: "px", value: 20 } },
        children: [
            Container({
                style: { width: { kind: "grow" } },
                children: [],
            }),
            Button({
                // Dim the button until the user picks an import.json. Without a selection
                // we don't know which one to load — directories can hold multiple
                // *.import.json files so there's no useful default.
                text: () =>
                    selectedImportName !== null
                        ? `Load ${selectedImportName}`
                        : "Select an import.json",
                style: {
                    width: { kind: "px", value: 220 },
                    height: { kind: "grow" },
                    background: () =>
                        selectedImportPath !== null ? COLOR_BUTTON_PRIMARY : COLOR_BUTTON,
                    hoverBackground: () =>
                        selectedImportPath !== null
                            ? COLOR_BUTTON_PRIMARY_HOVER
                            : COLOR_BUTTON_HOVER,
                },
                onClick: () => {
                    if (selectedImportPath !== null) loadAsImport(selectedImportPath);
                },
            }),
        ],
    });
}

function divider(): Element {
    return Container({
        style: { height: { kind: "px", value: 1 }, background: COLOR_DIVIDER },
        children: [],
    });
}

function browserContent(): Element {
    return Col({
        style: { padding: 8, gap: 6, height: { kind: "grow" } },
        children: [
            header(),
            divider(),
            pathBar(),
            searchBar(),
            listBody(),
            loadButton(),
        ],
    });
}

const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };

export function openFileBrowser(initialDir?: string): void {
    if (initialDir !== undefined && initialDir.length > 0) {
        setCwd(resolveExistingDir(initialDir));
    } else {
        setCwd(resolveExistingDir(cwd));
    }
    openPopover({
        anchor: ZERO,
        content: browserContent(),
        width: 520,
        height: 320,
        key: "file-browser",
        placement: "modal",
    });
}
