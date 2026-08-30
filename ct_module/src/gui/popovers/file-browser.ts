/// <reference types="../../../CTAutocomplete" />

import { Child, Element, Rect } from "../lib/layout";
import { Button, Col, Container, Icon, Input, Row, Scroll, Text } from "../lib/components";
import { closeAllPopovers, openPopover } from "../lib/popovers";
import { closeActiveMenu, openMenu } from "../lib/menu";
import { Icons, type IconName } from "../lib/icons.generated";
import { openRenameFilePopover } from "./rename-file";
import { openConfirmPopover } from "./confirm";
import { openPathInOS, showInExplorer, revealInFilesLabel } from "../../utils/osShell";
import {
    ACCENT_INFO,
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
    SIZE_ROW_H,
} from "../lib/theme";
import { getHousingUuid, setImportJsonPath } from "../state";
import { addRecent } from "../persistence/recents";
import { normalizePathSeparators } from "htsw-editor-common/project";
import { basename, normalizeHtswPath } from "../lib/pathDisplay";
import { queueSourcePath } from "../left-panel/projects/source";
import { javaType } from "../lib/java";
import { PROJECTS_ROOT } from "../../project/paths";
import { boundImportJsonPath } from "../../importCache/houseBindings";
import { asNullableString, defineRootDoc } from "../../persistence/store";

type Entry = {
    name: string;
    fullPath: string;
    isDir: boolean;
    /** lower-cased extension (e.g. "json", "htsl") or "" for dirs / extensionless files. */
    ext: string;
};

let cwd: string = PROJECTS_ROOT;
// Directories the user navigated away from, newest last — the Back button
// retraces them (browser-style), it does not go to the parent folder.
let backStack: string[] = [];
// Mirror of the path-bar input. Decoupled from `cwd` so typing/pasting a
// path doesn't navigate or normalize until the user commits (Enter / Go).
// All non-typed cwd writes route through `setCwd`, which keeps the draft
// in sync so the bar always shows the actual current directory.
let pathDraft: string = cwd;
let filter = "";
// Selected file in the current browser mode. Cleared on directory change so
// a stale selection from a previous folder cannot be activated.
let selectedFilePath: string | null = null;
let selectedFileName: string | null = null;
let saveNameDraft = "actions.htsl";

type BrowserMode =
    | { kind: "importJson"; onSelect: ((path: string) => void) | null }
    | { kind: "htsl"; onSelect: (path: string) => void }
    | { kind: "htslDestination"; onSelect: (path: string) => void };

let browserMode: BrowserMode = { kind: "importJson", onSelect: null };

function isHtslMode(): boolean {
    return browserMode.kind === "htsl" || browserMode.kind === "htslDestination";
}

const appendHtslDir = defineRootDoc<string | null>({
    file: "append-htsl-directory.json",
    // A convenience breadcrumb, not user data — a bad file just means the
    // browser opens at its default location and re-learns on the next pick.
    onReadError: "defaults",
    fallback: null,
    parse: asNullableString,
});

function readRememberedAppendHtslDir(): string | null {
    // Checked on read rather than write: the directory can be deleted between
    // sessions, and a remembered path that no longer exists must not be used
    // as the browser's starting point.
    const stored = appendHtslDir.get();
    if (stored === null || !dirExists(stored)) return null;
    return normalizeHtswPath(stored);
}

function rememberAppendHtslDir(path: string): void {
    const normalized = normalizeHtswPath(path);
    if (normalized === appendHtslDir.get()) return;
    appendHtslDir.set(normalized);
}

function boundProjectPath(): string | null {
    const uuid = getHousingUuid();
    if (uuid === null) return null;
    const path = boundImportJsonPath(uuid);
    return path !== null && pathExists(path) ? path : null;
}

function setCwd(next: string): void {
    closeActiveMenu();
    cwd = normalizeHtswPath(next);
    pathDraft = cwd;
    selectedFilePath = null;
    selectedFileName = null;
    if (isHtslMode()) rememberAppendHtslDir(cwd);
    else preselectImportJson();
}

/**
 * A folder holding an import.json is, for picking purposes, that import.json —
 * so entering one arms the Select button straight away instead of making the
 * user click the file too.
 */
function preselectImportJson(): void {
    const target = `${cwd}/import.json`;
    if (!pathExists(target)) return;
    selectedFilePath = target;
    selectedFileName = "import.json";
}

function navigateTo(next: string): void {
    const normalized = normalizeHtswPath(next);
    if (normalized === cwd) return;
    backStack.push(cwd);
    setCwd(normalized);
}

function goBack(): void {
    const prev = backStack.pop();
    if (prev !== undefined) setCwd(prev);
}

function dirExists(path: string): boolean {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        const p = Paths.get(path);
        return Files.exists(p) && Files.isDirectory(p);
    } catch (_e) {
        return false;
    }
}

/** Walk up parents until an existing directory is found, falling back to ".". */
function resolveExistingDir(start: string): string {
    let cur = normalizePathSeparators(start);
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
    let p: HtswJavaPath;
    try {
        p = Paths.get(dir);
    } catch (_e) {
        return out;
    }
    let stream: HtswJavaDirectoryStream;
    try {
        stream = Files.newDirectoryStream(p);
    } catch (_e) {
        return out;
    }
    try {
        const it = stream.iterator();
        for (;;) {
            let entry: HtswJavaPath;
            try {
                if (!it.hasNext()) break;
                entry = it.next();
            } catch (_e) {
                break;
            }
            try {
                const fileName = entry.getFileName();
                if (fileName === null) continue;
                const name = String(fileName.toString());
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
    // Selectable files first, then folders, then everything else.
    const rank = (e: Entry): number => {
        if (isSelectableEntry(e)) return 0;
        return e.isDir ? 1 : 2;
    };
    out.sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    return out;
}

function isImportJsonEntry(entry: Entry): boolean {
    if (entry.isDir) return false;
    return entry.name.toLowerCase() === "import.json" || entry.ext === "json";
}

function isSelectableEntry(entry: Entry): boolean {
    return browserMode.kind === "importJson"
        ? isImportJsonEntry(entry)
        : !entry.isDir && entry.ext === "htsl";
}

function isSelectableFileName(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return browserMode.kind === "importJson"
        ? lower.length >= 5 && lower.lastIndexOf(".json") === lower.length - 5
        : lower.length >= 5 && lower.lastIndexOf(".htsl") === lower.length - 5;
}

function selectionDescription(): string {
    return browserMode.kind === "importJson"
        ? "an import.json"
        : browserMode.kind === "htslDestination"
          ? "an HTSL destination"
          : "an HTSL file";
}

function selectFile(entry: Entry): void {
    selectedFilePath = entry.fullPath;
    selectedFileName = entry.name;
    if (browserMode.kind === "htslDestination") saveNameDraft = entry.name;
}

function navigateInto(entry: Entry): void {
    if (entry.isDir) {
        navigateTo(entry.fullPath);
    } else if (isSelectableEntry(entry)) {
        activateFile(entry.fullPath);
    }
}

function activateFile(path: string): void {
    if (browserMode.kind === "htslDestination") {
        selectHtslDestination(path);
        return;
    }
    if (browserMode.kind === "htsl") {
        const slash = normalizeHtswPath(path).lastIndexOf("/");
        if (slash > 0) rememberAppendHtslDir(path.substring(0, slash));
    }
    if (browserMode.onSelect !== null) {
        const onSelect = browserMode.onSelect;
        const kind = browserMode.kind;
        closeAllPopovers();
        onSelect(path);
        if (kind === "importJson") {
            addRecent(path);
            ChatLib.chat(`&a[htsw] Selected ${path}`);
        }
        return;
    }
    if (browserMode.kind === "importJson") {
        queueSourcePath(path);
        setImportJsonPath(path);
        addRecent(path);
        closeAllPopovers();
        ChatLib.chat(`&a[htsw] Loaded ${path}`);
        return;
    }
}

function finishHtslDestination(path: string): void {
    if (browserMode.kind !== "htslDestination") return;
    const onSelect = browserMode.onSelect;
    const slash = normalizeHtswPath(path).lastIndexOf("/");
    if (slash > 0) rememberAppendHtslDir(path.substring(0, slash));
    closeAllPopovers();
    onSelect(path);
}

function selectHtslDestination(path: string): void {
    if (!path.toLowerCase().endsWith(".htsl")) {
        ChatLib.chat("&c[htsw] Export destinations must end in .htsl.");
        return;
    }
    if (!pathExists(path)) {
        finishHtslDestination(path);
        return;
    }
    openConfirmPopover({
        title: `Replace ${basename(path)}?`,
        lines: ["The existing file will be replaced after the Housing read succeeds."],
        confirmLabel: "Replace",
        onConfirm: () => finishHtslDestination(path),
    });
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
    let p: HtswJavaPath;
    try {
        p = Paths.get(normalized);
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
            navigateTo(normalized);
            return;
        }
        const fnObj = p.getFileName();
        if (fnObj === null) {
            navigateTo(normalized);
            return;
        }
        const fname = String(fnObj.toString());
        if (isSelectableFileName(fname)) {
            activateFile(normalized);
            return;
        }
        const parent = p.getParent();
        if (parent !== null) {
            navigateTo(normalizePathSeparators(String(parent.toString())));
            ChatLib.chat(
                `&7[htsw] ${fname} is not ${selectionDescription()} — jumped to its folder`
            );
            return;
        }
        ChatLib.chat(`&c[htsw] Cannot open ${fname}`);
        return;
    }
    if (
        browserMode.kind === "htslDestination" &&
        isSelectableFileName(basename(normalized))
    ) {
        const parent = p.getParent();
        if (parent !== null && Files.exists(parent) && Files.isDirectory(parent)) {
            selectHtslDestination(normalized);
            return;
        }
    }
    const fallback = resolveExistingDir(normalized);
    navigateTo(fallback);
    ChatLib.chat(`&c[htsw] Path not found, jumped to ${fallback}`);
}

function openInOS(): void {
    try {
        openPathInOS(cwd);
    } catch (err) {
        ChatLib.chat(`&c[htsw] Open in OS failed: ${String(err)}`);
    }
}

function pathExists(path: string): boolean {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        return Files.exists(Paths.get(path));
    } catch (_e) {
        return false;
    }
}

function newFolder(): void {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        let i = 1;
        while (i <= 100) {
            const candidate = `${cwd}/new-folder${i === 1 ? "" : `-${i}`}`;
            const p = Paths.get(candidate);
            if (!Files.exists(p)) {
                Files.createDirectories(p);
                openRenameFilePopover(ZERO, candidate);
                return;
            }
            i++;
        }
    } catch (err) {
        ChatLib.chat(`&c[htsw] New folder failed: ${String(err)}`);
    }
}

function confirmNewImportJson(): void {
    const target = `${cwd}/import.json`;
    const exists = pathExists(target);
    openConfirmPopover({
        title: exists ? "Open existing import.json?" : "Create import.json here?",
        lines: exists
            ? ["This folder already has an import.json.", "It will be loaded as the active project."]
            : ["Creates an empty import.json in this folder.", "It will be loaded as the active project."],
        confirmLabel: exists ? "Open" : "Create",
        onConfirm: () => newImportJson(),
    });
}

function newImportJson(): void {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        const target = `${cwd}/import.json`;
        const p = Paths.get(target);
        if (Files.exists(p)) {
            activateFile(target);
            return;
        }
        FileLib.write(target, "{\n}\n", true);
        ChatLib.chat(`&a[htsw] Created ${target}`);
        activateFile(target);
    } catch (err) {
        ChatLib.chat(`&c[htsw] Init import.json failed: ${String(err)}`);
    }
}

function deletePathRecursive(Files: HtswJavaFilesClass, path: HtswJavaPath): void {
    if (Files.isDirectory(path)) {
        const stream = Files.newDirectoryStream(path);
        try {
            const it = stream.iterator();
            while (it.hasNext()) {
                deletePathRecursive(Files, it.next());
            }
        } finally {
            try { stream.close(); } catch (_e) { /* ignore */ }
        }
    }
    Files.delete(path);
}

function deleteEntry(entry: Entry): void {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        deletePathRecursive(Files, Paths.get(entry.fullPath));
        if (selectedFilePath === entry.fullPath) {
            selectedFilePath = null;
            selectedFileName = null;
        }
        ChatLib.chat(`&a[htsw] Deleted ${entry.name}`);
    } catch (err) {
        ChatLib.chat(`&c[htsw] Delete failed: ${String(err)}`);
    }
}

// Same icon vocabulary as the Projects tree: blue { } for import.jsons,
// code/box files dimmed, folders neutral.
function iconNameFor(e: Entry): IconName {
    if (e.isDir) return Icons.folder;
    if (e.name.toLowerCase() === "import.json" || e.ext === "json") return Icons.fileJson;
    if (e.ext === "htsl") return Icons.fileCode;
    if (e.ext === "snbt") return Icons.fileBox;
    return Icons.file;
}

function iconColorFor(e: Entry): number {
    if (e.isDir) return COLOR_TEXT_DIM;
    if (e.name.toLowerCase() === "import.json" || e.ext === "json") return ACCENT_INFO;
    return COLOR_TEXT_DIM;
}

function fileRow(entry: Entry): Element {
    const selectable = isSelectableEntry(entry);
    const loadable = entry.isDir || selectable;
    const isSelected =
        selectable && selectedFilePath !== null && selectedFilePath === entry.fullPath;
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
                            label: revealInFilesLabel(),
                            onClick: () => showInExplorer(entry.fullPath),
                        },
                        { kind: "separator" },
                        {
                            // Delete is irreversible (no trash) and recurses into
                            // folders, so route through the modal confirm.
                            label: entry.isDir ? "Delete folder" : "Delete",
                            onClick: () => {
                                openConfirmPopover({
                                    title: `Delete ${entry.name}?`,
                                    lines: entry.isDir
                                        ? ["Deletes the folder and everything inside it.", "This can't be undone."]
                                        : ["This can't be undone."],
                                    confirmLabel: "Delete",
                                    danger: true,
                                    onConfirm: () => deleteEntry(entry),
                                });
                            },
                        },
                    ],
                    { keepUnderlying: true }
                );
                return;
            }
            // Dirs: single-click navigates in (the second click of a double is
            // ignored so a fast double doesn't descend twice). Selectable files
            // activate on double-click; other files are ignored.
            if (entry.isDir) {
                if (!info.isDoubleClickSecond) navigateInto(entry);
                return;
            }
            if (!selectable) return;
            if (info.isDoubleClickSecond) navigateInto(entry);
            else selectFile(entry);
        },
        children: [
            Icon({
                name: iconNameFor(entry),
                color: iconColorFor(entry),
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                },
            }),
            Text({
                text: entry.name,
                color: loadable ? COLOR_TEXT : COLOR_TEXT_DIM,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            Text({
                text: entry.isDir ? "dir" : entry.ext,
                color: COLOR_TEXT_DIM,
            }),
        ],
    });
}

const HEADER_ICON_SIZE = 12;

function headerActionButton(
    icon: IconName,
    text: string,
    width: number,
    onClick: () => void
): Element {
    return Button({
        style: {
            width: { kind: "px", value: width },
            height: { kind: "grow" },
            justify: "start",
            gap: 5,
            padding: { side: "x", value: 6 },
        },
        children: [
            Icon({
                name: icon,
                style: {
                    width: { kind: "px", value: HEADER_ICON_SIZE },
                    height: { kind: "px", value: HEADER_ICON_SIZE },
                },
            }),
            Text({ text }),
        ],
        onClick,
    });
}

function header(): Element {
    const projectActions: Element[] = browserMode.kind === "importJson"
        ? [
              headerActionButton(Icons.filePlus2, "Init import.json", 128, () =>
                  confirmNewImportJson()
              ),
          ]
        : [];
    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 }, align: "center" },
        children: [
            Text({
                text:
                    browserMode.kind === "importJson"
                        ? "Browser"
                        : browserMode.kind === "htslDestination"
                          ? "Export HTSL"
                          : "Append HTSL",
                color: ACCENT_WARN,
                style: {
                    width: {
                        kind: "px",
                        value: browserMode.kind === "importJson" ? 60 : 90,
                    },
                },
            }),
            Button({
                tooltip: "Back",
                tooltipColor: COLOR_TEXT_DIM,
                style: { width: { kind: "px", value: 28 }, height: { kind: "grow" } },
                children: [
                    Icon({
                        name: Icons.arrowLeft,
                        style: {
                            width: { kind: "px", value: HEADER_ICON_SIZE },
                            height: { kind: "px", value: HEADER_ICON_SIZE },
                        },
                    }),
                ],
                onClick: () => goBack(),
            }),
            headerActionButton(Icons.externalLink, "Open in OS", 92, () => openInOS()),
            headerActionButton(Icons.folderPlus, "New Folder", 98, () => newFolder()),
            ...projectActions,
            Container({
                style: { width: { kind: "grow" } },
                children: [],
            }),
            headerActionButton(Icons.x, "Close", 70, () => closeAllPopovers()),
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
                placeholder:
                    browserMode.kind === "importJson"
                        ? "paste a path or import.json…"
                        : "paste a path or .htsl file…",
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

function selectionButton(): Element {
    if (browserMode.kind === "htslDestination") {
        return Row({
            style: { gap: 6, height: { kind: "px", value: 20 }, align: "center" },
            children: [
                Text({ text: "Save as", color: COLOR_TEXT_DIM }),
                Input({
                    id: "file-browser-save-name",
                    value: () => saveNameDraft,
                    onChange: (value) => {
                        saveNameDraft = value;
                    },
                    onSubmit: () => activateSaveName(),
                    placeholder: "actions.htsl",
                    style: { width: { kind: "grow" }, height: { kind: "grow" } },
                }),
                Button({
                    text: "Choose destination",
                    style: {
                        width: { kind: "px", value: 130 },
                        height: { kind: "grow" },
                        background: COLOR_BUTTON_PRIMARY,
                        hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                    },
                    onClick: () => activateSaveName(),
                }),
            ],
        });
    }
    return Row({
        style: { gap: 6, height: { kind: "px", value: 20 } },
        children: [
            Container({
                style: { width: { kind: "grow" } },
                children: [],
            }),
            Button({
                text: () =>
                    selectedFileName !== null
                        ? `${browserMode.kind === "htsl" ? "Append" : browserMode.onSelect === null ? "Load" : "Select"} ${selectedFileName}`
                        : `Select ${selectionDescription()}`,
                style: {
                    width: { kind: "px", value: 220 },
                    height: { kind: "grow" },
                    background: () =>
                        selectedFilePath !== null ? COLOR_BUTTON_PRIMARY : COLOR_BUTTON,
                    hoverBackground: () =>
                        selectedFilePath !== null
                            ? COLOR_BUTTON_PRIMARY_HOVER
                            : COLOR_BUTTON_HOVER,
                },
                onClick: () => {
                    if (selectedFilePath !== null) activateFile(selectedFilePath);
                },
            }),
        ],
    });
}

function activateSaveName(): void {
    const raw = saveNameDraft.trim();
    if (raw.length === 0) {
        ChatLib.chat("&c[htsw] Enter an HTSL file name.");
        return;
    }
    if (raw.indexOf("/") >= 0 || raw.indexOf("\\") >= 0) {
        ChatLib.chat(
            "&c[htsw] Enter a file name here, or paste a full path in the path bar."
        );
        return;
    }
    const fileName = raw.toLowerCase().endsWith(".htsl") ? raw : `${raw}.htsl`;
    selectHtslDestination(`${cwd}/${fileName}`);
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
            selectionButton(),
        ],
    });
}

const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };

export function openFileBrowser(initialDir?: string): void {
    openFileBrowserWithImportJsonSelection(initialDir, null);
}

export function openFileBrowserWithImportJsonSelection(
    initialDir: string | undefined,
    onSelect: ((path: string) => void) | null
): void {
    browserMode = { kind: "importJson", onSelect };
    openConfiguredFileBrowser(initialDir);
}

export function openFileBrowserWithHtslSelection(
    initialDir: string | undefined,
    onSelect: (path: string) => void
): void {
    browserMode = { kind: "htsl", onSelect };
    openConfiguredFileBrowser(
        initialDir ?? readRememberedAppendHtslDir() ?? boundProjectPath() ?? PROJECTS_ROOT
    );
}

export function openFileBrowserWithHtslDestination(
    initialDir: string | undefined,
    onSelect: (path: string) => void
): void {
    browserMode = { kind: "htslDestination", onSelect };
    saveNameDraft = "actions.htsl";
    openConfiguredFileBrowser(
        initialDir ?? readRememberedAppendHtslDir() ?? boundProjectPath() ?? PROJECTS_ROOT
    );
}

function openConfiguredFileBrowser(initialDir: string | undefined): void {
    backStack = [];
    if (initialDir !== undefined && initialDir.length > 0) {
        setCwd(resolveExistingDir(initialDir));
    } else {
        setCwd(resolveExistingDir(PROJECTS_ROOT));
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
