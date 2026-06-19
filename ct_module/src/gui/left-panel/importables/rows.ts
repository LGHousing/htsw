/// <reference types="../../../../CTAutocomplete" />

import {
    ClickInfo,
    Element,
    Rect,
} from "../../lib/layout";
import { Col, Container, Icon, Input, McItem, Scroll, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import { openMenu, MenuAction } from "../../lib/menu";
import { closeAllPopovers, openPopover } from "../../lib/popovers";
import { openRenameImportablePopover } from "../../popovers/rename-importable";
import { openConfirmPopover } from "../../popovers/confirm";
import {
    getHousingUuid,
    isAutoTrackSource,
    isHouseTrusted,
    isImportableChecked,
    setExportImportJsonPath,
    toggleAutoTrackSource,
    toggleImportableChecked,
} from "../../state";
import { ACCENT_DANGER, ACCENT_INFO, ACCENT_SUCCESS, ACCENT_WARN, COLOR_TEXT, COLOR_TEXT_DIM, COLOR_TEXT_FAINT } from "../../lib/theme";
import { diagnosticCountsFor, type SeverityCounts } from "../../cache-status/diagnosticCounts";
import { openEditFunctionFieldPopover } from "../../popovers/edit-function";
import { cacheStateForImportable, linkStatusIcon } from "../../cache-status";
import { isScannableType } from "../houses/types";
import {
    hasSubList,
    importableDeclaringPath,
    importableSourcePath,
    importableSubListPath,
    type SubListKind,
} from "../../parsing/importablePaths";
import { moveImportableEntry } from "../../../project/moveImportable";
import { importableIdentity, importableKey } from "../../../importCache/paths";
import { houseDisplayName } from "../../../importCache/aliases";
import {
    removeImportableEntry,
    setHouseUuidKey,
    type Section,
} from "../../../project/importJsonMutations";
import { countFilesRecursive, deleteDirRecursive } from "../../../utils/filesystem";
import {
    canonicalPath,
    getParseAt,
    invalidateParseCacheEntry,
    markParseStale,
    requestParse,
    touchParseCacheFile,
} from "../../parsing/parses";
import { recordHouseBinding } from "../../../importCache/houseBindings";
import { shortPath } from "../../lib/pathDisplay";
import {
    houseTypeScanned,
    listCachedImportables,
    readImportableCache,
} from "../../../importCache/cache";
import { canonicalIconItem } from "../../../importCache/hash";
import { addToQueue, makeImportableQueueItem, queueItemKey, removeFromQueueKey } from "../../right-panel/import-tab/queue";
import { isImportRunning } from "../../../housingSync/runtimeState";
import { composeFileMenu, composeImportableMenu } from "../../menus/fileMenu";
import { autoTrackRefresh, queueModifiedFromParse } from "../../right-panel/import-tab/importController";
import { SourceDir, SourceFile, removeSource } from "./source";
import { type IncludeNode, includeTreeOf, subtreeImportableCount } from "./includeTree";
import { showInExplorer, openInVSCode } from "../../../utils/osShell";
import {
    closeTab,
    closeTabsUnder,
    confirmSelect,
    previewSelect,
} from "../../right-panel/selection";
import {
    Result,
    ResultImport,
    IMPORTABLE_TYPE_COLORS,
    ROW_BG,
    ROW_HOVER_BG,
    bumpTreeRevision,
} from "./rowModel";
import { EVENT_ICONS } from "htsw/types";
import type { Bounds, Importable } from "htsw/types";

export let searchQuery = "";
export function setSearchQuery(v: string): void {
    searchQuery = v;
    bumpTreeRevision();
}

const importExpansion: Map<string, boolean> = new Map();
export function expansionKey(sourceKey: string, fullPath: string): string {
    return `${sourceKey}::${fullPath}`;
}
// Paths that should start expanded regardless of the sole-import default —
// e.g. the freshly created starter project. An explicit user toggle wins.
const autoExpandPaths = new Set<string>();
/** Expand a file even past an explicit user collapse — for an explicit
 * "open this project" action, where staying collapsed reads as a no-op. */
export function forceImportExpand(fullPath: string): void {
    autoExpandPaths.add(fullPath);
    const suffix = "::" + fullPath;
    const stale: string[] = [];
    importExpansion.forEach((_v, k) => {
        if (k.indexOf(suffix) === k.length - suffix.length) stale.push(k);
    });
    for (let i = 0; i < stale.length; i++) importExpansion.delete(stale[i]);
    bumpTreeRevision();
}
export function isImportExpanded(expKey: string, defaultExpanded: boolean): boolean {
    const explicit = importExpansion.get(expKey);
    if (explicit !== undefined) return explicit;
    const sep = expKey.indexOf("::");
    if (sep !== -1 && autoExpandPaths.has(expKey.substring(sep + 2))) return true;
    return defaultExpanded;
}
export const collapsedRoots: Set<string> = new Set();

// Include-group rows (included import.jsons rendered as nested groups under
// the entry file). Explicit toggles win over the default the tree passes in
// (collapsed normally, expanded while a search/type filter narrows).
const includeGroupExpansion: Map<string, boolean> = new Map();
export function includeGroupKey(entryFullPath: string, nodeFullPath: string): string {
    return `${entryFullPath}::${nodeFullPath}`;
}
export function isIncludeGroupExpanded(expKey: string, defaultExpanded: boolean): boolean {
    return includeGroupExpansion.get(expKey) ?? defaultExpanded;
}

export const importableExpansion: Set<string> = new Set();
export function importableExpansionKey(parentFullPath: string, imp: Importable): string {
    return `${parentFullPath}::${imp.type}:${importableIdentity(imp)}`;
}

const SUB_LIST_LABELS: { [k in SubListKind]: string } = {
    onEnterActions: "Enter actions",
    onExitActions: "Exit actions",
    leftClickActions: "Left click actions",
    rightClickActions: "Right click actions",
};

export function subListsOf(imp: Importable): SubListKind[] {
    if (imp.type === "REGION") {
        const out: SubListKind[] = [];
        if (hasSubList(imp, "onEnterActions")) out.push("onEnterActions");
        if (hasSubList(imp, "onExitActions")) out.push("onExitActions");
        return out;
    }
    if (imp.type === "ITEM") {
        const out: SubListKind[] = [];
        if (hasSubList(imp, "leftClickActions")) out.push("leftClickActions");
        if (hasSubList(imp, "rightClickActions")) out.push("rightClickActions");
        return out;
    }
    return [];
}

type FieldDiff = "changed" | "added" | "removed";
export type MetadataField = { key: string; label: string; value: string; diff?: FieldDiff };

function formatPos(p: { x: number; y: number; z: number }): string {
    return p.x + ", " + p.y + ", " + p.z;
}

function getCachedImportable(imp: Importable): Importable | null {
    const uuid = getHousingUuid();
    if (uuid === null) return null;
    const entry = readImportableCache(uuid, imp.type, importableIdentity(imp));
    return entry === null ? null : entry.importable;
}

type HousePresenceState = "unscanned" | "present" | "absent";

function housePresenceStateFor(imp: Importable): HousePresenceState {
    const uuid = getHousingUuid();
    if (uuid === null || !houseTypeScanned(uuid, imp.type)) return "unscanned";
    const identity = importableIdentity(imp);
    const items = listCachedImportables(uuid, imp.type);
    for (let i = 0; i < items.length; i++) {
        if (items[i].name === identity) return "present";
    }
    return "absent";
}

// The file<->house link icon for one of your importables. Tooltips are framed
// from the file side ("what does this mean for importing this file?"); the
// Houses page maps the same icons with house-side wording.
function importableStatus(imp: Importable): Element {
    const uuid = getHousingUuid();
    if (uuid === null) {
        return linkStatusIcon("unknown", "No house detected");
    }
    // Items and NPCs have no house-side listing to scan (not in
    // HOUSE_CONTENT_TYPES) — an item exists only where an action or menu
    // references it. Presence can't be answered for these, so fall back to the
    // import baseline: does your file still match what was last imported?
    if (!isScannableType(imp.type)) {
        const baseline = cacheStateForImportable(imp);
        if (baseline === "current") {
            return linkStatusIcon("matches", "Files match this house");
        }
        if (baseline === "modified") {
            return linkStatusIcon("differs", "Import will update the house from these files");
        }
        // Never imported: file-side only as far as we can tell (items can't be
        // listed from a house to confirm otherwise). Show it as not-yet-linked
        // rather than "unknown" — import is the action that places/links it.
        return linkStatusIcon(
            "oneSided",
            imp.type === "ITEM"
                ? "Items can't be listed from a house — import to place it"
                : "Not listed from a house — import to place it"
        );
    }
    const presence = housePresenceStateFor(imp);
    // Once the type is scanned, absence is authoritative: it must win over a
    // stale Knowledge entry, or something the house dropped still shows a match.
    if (presence === "absent") {
        return linkStatusIcon("oneSided", "Not in this house");
    }
    if (!isHouseTrusted(uuid)) {
        return presence === "present"
            ? linkStatusIcon("present", "Exists in this house")
            : linkStatusIcon("unknown", "Scan this house to check whether it exists");
    }
    const cacheState = cacheStateForImportable(imp);
    if (cacheState === "current") {
        return linkStatusIcon("matches", "Files match this house");
    }
    if (cacheState === "modified") {
        return linkStatusIcon("differs", "Import will update the house from these files");
    }
    return presence === "present"
        ? linkStatusIcon("present", "In this house; content not read yet")
        : linkStatusIcon("unknown", "No Knowledge read yet");
}

function valDiff(a: unknown, b: unknown): FieldDiff | undefined {
    const aj = JSON.stringify(a ?? null);
    const bj = JSON.stringify(b ?? null);
    if (aj === bj) return undefined;
    if (aj === "null" && bj !== "null") return "removed";
    if (aj !== "null" && bj === "null") return "added";
    return "changed";
}

export function metadataFieldsOf(imp: Importable): MetadataField[] {
    const cached = getCachedImportable(imp);
    if (imp.type === "FUNCTION") {
        const cf = cached !== null && cached.type === "FUNCTION" ? cached : null;
        const fields: MetadataField[] = [
            {
                key: "repeatTicks",
                label: "Repeat",
                value: imp.repeatTicks !== undefined ? imp.repeatTicks + "t" : "off",
                diff: cf !== null ? valDiff(imp.repeatTicks, cf.repeatTicks) : undefined,
            },
            {
                key: "icon",
                label: "Icon",
                value: imp.icon !== undefined ? imp.icon.item : "default",
                // Compare in canonical form — house reads store bare item
                // names while the loader emits `minecraft:<name>`; comparing
                // raw strings would flag identical icons as changed.
                diff:
                    cf !== null
                        ? valDiff(
                              imp.icon !== undefined ? canonicalIconItem(imp.icon.item) : undefined,
                              cf.icon !== undefined ? canonicalIconItem(cf.icon.item) : undefined
                          )
                        : undefined,
            },
        ];
        if (imp.icon !== undefined) {
            fields.push({
                key: "iconCount",
                label: "Count",
                value: imp.icon.count !== undefined ? String(imp.icon.count) : "1",
                // count 1 and absent count are the same icon.
                diff:
                    cf !== null
                        ? valDiff(imp.icon.count ?? 1, cf.icon?.count ?? 1)
                        : undefined,
            });
        }
        return fields;
    }
    if (imp.type === "REGION") {
        const cr = cached !== null && cached.type === "REGION" ? cached : null;
        // The parser allows a region without bounds (the key is optional), so
        // the declared non-optional type is a lie here — guard or this throws
        // on every render of the expanded row.
        const bounds = imp.bounds as Bounds | undefined;
        if (bounds === undefined) {
            return [
                {
                    key: "bounds",
                    label: "Bounds",
                    value: "(not set)",
                    diff: cr !== null ? valDiff(undefined, cr.bounds) : undefined,
                },
            ];
        }
        return [
            {
                key: "boundsFrom", label: "From", value: formatPos(bounds.from),
                diff: cr !== null ? valDiff(bounds.from, cr.bounds.from) : undefined,
            },
            {
                key: "boundsTo", label: "To", value: formatPos(bounds.to),
                diff: cr !== null ? valDiff(bounds.to, cr.bounds.to) : undefined,
            },
        ];
    }
    if (imp.type === "MENU") {
        const cm = cached !== null && cached.type === "MENU" ? cached : null;
        return [
            {
                key: "size",
                label: "Size",
                value: imp.size !== undefined ? imp.size + " lines" : "default",
                diff: cm !== null ? valDiff(imp.size, cm.size) : undefined,
            },
        ];
    }
    return [];
}

function isImportableExpandable(imp: Importable): boolean {
    return subListsOf(imp).length > 0 || metadataFieldsOf(imp).length > 0;
}

function importableLabel(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}

function importablePreviewPath(parent: ResultImport, imp: Importable): string {
    const src = importableSourcePath(imp, parent.parse);
    if (src !== undefined) return src;
    return parent.fullPath;
}

const SECTION_BY_TYPE: { [k in Importable["type"]]: Section } = {
    FUNCTION: "functions",
    EVENT: "events",
    REGION: "regions",
    ITEM: "items",
    MENU: "menus",
    NPC: "npcs",
};

// Files this importable owns: its primary source (htsl/snbt) plus sub-list
// htsl files — minus the import.json itself and anything another importable
// in the same project also references (shared files survive the delete).
function ownedFilesOf(parent: ResultImport, imp: Importable): string[] {
    const mine = new Set<string>();
    const primary = importablePreviewPath(parent, imp);
    if (primary !== parent.fullPath) mine.add(primary);
    const kinds = subListsOf(imp);
    for (let i = 0; i < kinds.length; i++) {
        const p = importableSubListPath(imp, kinds[i], parent.parse);
        if (p !== undefined && p !== parent.fullPath) mine.add(p);
    }
    if (mine.size === 0) return [];
    const shared = new Set<string>();
    for (let i = 0; i < parent.importables.length; i++) {
        const other = parent.importables[i];
        if (other === imp) continue;
        const op = importablePreviewPath(parent, other);
        if (mine.has(op)) shared.add(op);
        const oKinds = subListsOf(other);
        for (let j = 0; j < oKinds.length; j++) {
            const sp = importableSubListPath(other, oKinds[j], parent.parse);
            if (sp !== undefined && mine.has(sp)) shared.add(sp);
        }
    }
    const out: string[] = [];
    for (const p of mine) {
        if (!shared.has(p)) out.push(p);
    }
    return out;
}

function confirmDeleteImportable(parent: ResultImport, imp: Importable): void {
    const identity = importableIdentity(imp);
    const files = ownedFilesOf(parent, imp);
    const lines = [`Removes the ${imp.type} entry from import.json.`];
    for (let i = 0; i < Math.min(files.length, 4); i++) {
        lines.push(`Deletes ${shortPath(files[i])}`);
    }
    if (files.length > 4) lines.push(`…and ${files.length - 4} more files`);
    openConfirmPopover({
        title: `Delete "${identity}" from the project?`,
        lines,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: () => {
            if (!removeImportableEntry(parent.fullPath, SECTION_BY_TYPE[imp.type], identity)) {
                ChatLib.chat(`&c[htsw] Couldn't remove '${identity}' from ${shortPath(parent.fullPath)}`);
                return;
            }
            for (let i = 0; i < files.length; i++) {
                try {
                    FileLib.delete(files[i]);
                } catch (_e) {
                    ChatLib.chat(`&e[htsw] Couldn't delete ${shortPath(files[i])}`);
                }
                closeTab(files[i]);
            }
            removeFromQueueKey(queueItemKey(makeImportableQueueItem(imp, parent.fullPath)));
            markParseStale(parent.fullPath);
            requestParse(parent.fullPath);
            bumpTreeRevision();
            ChatLib.chat(`&a[htsw] Deleted '${identity}' from ${shortPath(parent.fullPath)}.`);
        },
    });
}

function confirmDeleteProject(importJsonPath: string): void {
    const dir = projectDirOf(importJsonPath);
    const count = countFilesRecursive(dir);
    openConfirmPopover({
        title: "Delete the WHOLE project folder?",
        lines: [
            shortPath(dir),
            `Permanently deletes ${count} file${count === 1 ? "" : "s"} — everything in this`,
            "folder, not just the import.json.",
        ],
        confirmLabel: `Delete ${count} file${count === 1 ? "" : "s"}`,
        danger: true,
        onConfirm: () => {
            const ok = deleteDirRecursive(dir);
            removeSource(importJsonPath);
            closeTabsUnder(dir);
            invalidateParseCacheEntry(importJsonPath);
            bumpTreeRevision();
            if (ok) ChatLib.chat(`&a[htsw] Deleted ${dir}.`);
            else ChatLib.chat(`&c[htsw] Couldn't fully delete ${dir} — check it manually.`);
        },
    });
}

function fsActions(fullPath: string): MenuAction[] {
    return [
        { label: "Show in explorer", onClick: () => showInExplorer(fullPath) },
        { label: "Open with VSCode", onClick: () => openInVSCode(fullPath) },
    ];
}

function withFsActions(extras: MenuAction[], fullPath: string): MenuAction[] {
    return extras.concat(fsActions(fullPath));
}

export function dirRootActions(s: SourceDir): MenuAction[] {
    const extras: MenuAction[] = [
        {
            label: "Close",
            onClick: () => {
                removeSource(s.fullPath);
                collapsedRoots.delete(dirRootKey(s));
                bumpTreeRevision();
            },
        },
    ];
    return withFsActions(extras, s.fullPath);
}

// Right-click "open for real": pins a non-italic tab (confirmSelect), the
// menu counterpart to the transient double-click preview.
function openInViewAction(path: string): MenuAction {
    return {
        label: "Open in View",
        icon: Icons.eye,
        onClick: () => confirmSelect(path),
    };
}

// Whether the project has anywhere to move an importable TO. Deliberately
// cheap (one WeakMap hit) because the row menu is rebuilt per visible row
// per frame — the real destination list resolves paths only on click.
function projectHasIncludes(parent: ResultImport): boolean {
    return parent.parse !== null && includeTreeOf(parent).includes.length > 0;
}

// The "Move to…" destination picker renders the include tree as a collapsible
// folder tree (caret expands, clicking the row moves) instead of the old flat
// dump of every project-relative path. State is rebuilt fresh on each open.
type MoveNode = {
    path: string;
    label: string;
    depth: number;
    isCurrent: boolean;
    children: MoveNode[];
    // Destinations reachable in this subtree, excluding the importable's current
    // file — shown as a faint count on folders.
    selectableCount: number;
};

const MOVE_INDENT = 12;
const MOVE_CARET_W = 18;
const MOVE_ROW_H = 18;
const MOVE_SEARCH_THRESHOLD = 8;

let moveTreeRoots: MoveNode[] = [];
const moveExpansion: Set<string> = new Set();
let moveFilter = "";
let moveShowSearch = false;
let moveCtx: { entryPath: string; section: Section; identity: string } | null = null;

function dirOfPath(p: string): string {
    const s = p.split("\\").join("/");
    const i = s.lastIndexOf("/");
    return i < 0 ? s : s.substring(0, i);
}

function baseNameOf(p: string): string {
    const s = p.split("\\").join("/");
    const i = s.lastIndexOf("/");
    return i < 0 ? s : s.substring(i + 1);
}

// A destination's label is its path relative to its parent node's directory with
// a trailing import.json dropped, so a sub-include reads as "clocks" instead of
// "functions/clocks/import.json".
function moveNodeLabel(parentDir: string, nodePath: string): string {
    const np = nodePath.split("\\").join("/");
    const base = parentDir.split("\\").join("/");
    let rel = np.indexOf(base + "/") === 0 ? np.substring(base.length + 1) : np;
    const tail = "/import.json";
    if (
        rel.length >= tail.length &&
        rel.substring(rel.length - tail.length).toLowerCase() === tail
    ) {
        rel = rel.substring(0, rel.length - tail.length);
    } else if (rel.toLowerCase() === "import.json") {
        rel = baseNameOf(base);
    }
    return rel.length === 0 ? "import.json" : rel;
}

function buildMoveNode(
    node: IncludeNode,
    parentDir: string,
    depth: number,
    current: string
): MoveNode {
    const path = canonicalPath(node.path);
    const dir = dirOfPath(path);
    const children: MoveNode[] = [];
    for (let i = 0; i < node.includes.length; i++) {
        children.push(buildMoveNode(node.includes[i], dir, depth + 1, current));
    }
    const isCurrent = path === current;
    let selectableCount = isCurrent ? 0 : 1;
    for (let i = 0; i < children.length; i++) selectableCount += children[i].selectableCount;
    return {
        path,
        label: moveNodeLabel(parentDir, path),
        depth,
        isCurrent,
        children,
        selectableCount,
    };
}

// Rows visible under the current expansion (no filter) — used to size the
// popover so the default-expanded top level fills it without dead space.
function countVisibleMoveRows(nodes: MoveNode[]): number {
    let n = 0;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        n += 1;
        if (node.children.length > 0 && moveExpansion.has(node.path)) {
            n += countVisibleMoveRows(node.children);
        }
    }
    return n;
}

function moveSubtreeMatches(n: MoveNode, q: string): boolean {
    if (n.label.toLowerCase().indexOf(q) >= 0) return true;
    for (let i = 0; i < n.children.length; i++) {
        if (moveSubtreeMatches(n.children[i], q)) return true;
    }
    return false;
}

function performMoveTo(destPath: string): void {
    const ctx = moveCtx;
    if (ctx === null) return;
    const res = moveImportableEntry(ctx.entryPath, ctx.section, ctx.identity, destPath);
    if (!res.ok) {
        ChatLib.chat(`&c[htsw] Move failed: ${res.message}`);
        return;
    }
    for (let i = 0; i < res.movedFiles.length; i++) closeTab(res.movedFiles[i].from);
    invalidateParseCacheEntry(ctx.entryPath);
    requestParse(ctx.entryPath);
    bumpTreeRevision();
    ChatLib.chat(`&a[htsw] Moved '${ctx.identity}' to ${shortPath(destPath)}.`);
    closeAllPopovers();
}

function moveRowElement(n: MoveNode, expanded: boolean): Element {
    const hasChildren = n.children.length > 0;
    const children: Element[] = [];
    if (n.depth > 0) {
        children.push(
            Container({
                style: { width: { kind: "px", value: n.depth * MOVE_INDENT } },
                children: [],
            })
        );
    }
    if (hasChildren) {
        children.push(
            caretButton(
                expanded,
                () => {
                    if (moveExpansion.has(n.path)) moveExpansion.delete(n.path);
                    else moveExpansion.add(n.path);
                },
                MOVE_CARET_W
            )
        );
    } else {
        children.push(
            Container({
                style: { width: { kind: "px", value: MOVE_CARET_W } },
                children: [],
            })
        );
    }
    // Every destination is an import.json — the same blue { } the main tree
    // uses. Expandable ones are distinguished by the caret, not a folder icon.
    children.push(Icon({ name: Icons.fileJson, color: ACCENT_INFO }));
    children.push(
        Container({ style: { width: { kind: "px", value: 6 } }, children: [] })
    );
    children.push(
        Text({
            text: n.label,
            color: n.isCurrent ? COLOR_TEXT_DIM : COLOR_TEXT,
            truncate: true,
            style: { width: { kind: "grow" } },
        })
    );
    if (n.isCurrent) {
        children.push(Text({ text: "here", color: COLOR_TEXT_FAINT }));
    } else if (hasChildren) {
        children.push(Text({ text: String(n.selectableCount), color: COLOR_TEXT_FAINT }));
    }
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: [
                { side: "left", value: 4 },
                { side: "right", value: 6 },
            ],
            height: { kind: "px", value: MOVE_ROW_H },
            background: ROW_BG,
            hoverBackground: n.isCurrent ? ROW_BG : ROW_HOVER_BG,
        },
        onClick: n.isCurrent
            ? undefined
            : (_rect, info) => {
                  if (info.isDoubleClickSecond) return;
                  if (info.button !== 0) return;
                  performMoveTo(n.path);
              },
        children,
    });
}

function moveTreeRows(): Element[] {
    const q = moveFilter.trim().toLowerCase();
    const filtering = q.length > 0;
    const out: Element[] = [];
    const emit = (n: MoveNode): void => {
        if (filtering && !moveSubtreeMatches(n, q)) return;
        const hasChildren = n.children.length > 0;
        const expanded = filtering ? true : moveExpansion.has(n.path);
        out.push(moveRowElement(n, expanded));
        if (hasChildren && expanded) {
            for (let i = 0; i < n.children.length; i++) emit(n.children[i]);
        }
    };
    for (let i = 0; i < moveTreeRoots.length; i++) emit(moveTreeRoots[i]);
    if (out.length === 0) {
        out.push(
            Container({
                style: { padding: 8 },
                children: [Text({ text: "No matches", color: COLOR_TEXT_DIM })],
            })
        );
    }
    return out;
}

function moveMenuWidth(nodes: MoveNode[]): number {
    let maxW = 150;
    const visit = (n: MoveNode): void => {
        const chrome = 4 + n.depth * MOVE_INDENT + MOVE_CARET_W + 16 + 6 + 24 + 6;
        const w = chrome + Renderer.getStringWidth(n.label);
        if (w > maxW) maxW = w;
        for (let i = 0; i < n.children.length; i++) visit(n.children[i]);
    };
    for (let i = 0; i < nodes.length; i++) visit(nodes[i]);
    return maxW > 340 ? 340 : maxW;
}

function openMoveToMenu(parent: ResultImport, imp: Importable): void {
    if (parent.parse === null) return;
    const root = includeTreeOf(parent);
    const rootPath = canonicalPath(root.path);
    const current = canonicalPath(importableDeclaringPath(imp, parent.parse));
    const projectDir = dirOfPath(rootPath);

    moveExpansion.clear();
    let total: number;
    if (rootPath === current) {
        // The importable lives in the entry file itself — drop that row and lift
        // its includes to the top level so the picker isn't rooted at a single
        // disabled "here" node.
        moveTreeRoots = [];
        for (let i = 0; i < root.includes.length; i++) {
            moveTreeRoots.push(buildMoveNode(root.includes[i], projectDir, 0, current));
        }
        total = 0;
        for (let i = 0; i < moveTreeRoots.length; i++) total += moveTreeRoots[i].selectableCount;
    } else {
        const rootNode = buildMoveNode(root, projectDir, 0, current);
        moveTreeRoots = [rootNode];
        total = rootNode.selectableCount;
    }
    if (total === 0) {
        ChatLib.chat("&7[htsw] Nowhere else to move it.");
        return;
    }

    // Expand the top-level folders so the picker opens showing real
    // destinations rather than a near-empty box; deeper levels stay collapsed.
    for (let i = 0; i < moveTreeRoots.length; i++) {
        if (moveTreeRoots[i].children.length > 0) moveExpansion.add(moveTreeRoots[i].path);
    }

    moveFilter = "";
    moveShowSearch = total > MOVE_SEARCH_THRESHOLD;
    const ctx = {
        entryPath: parent.fullPath,
        section: SECTION_BY_TYPE[imp.type],
        identity: importableIdentity(imp),
    };
    moveCtx = ctx;

    const visibleCount = countVisibleMoveRows(moveTreeRoots);
    const visibleRows = visibleCount < 2 ? 2 : visibleCount > 12 ? 12 : visibleCount;
    const scrollH = visibleRows * MOVE_ROW_H + 4;
    const height = 8 + 10 + (moveShowSearch ? 12 + 22 : 6) + scrollH + 8;

    const contentChildren: Element[] = [
        Text({ text: `Move '${ctx.identity}' to…`, color: ACCENT_WARN, truncate: true }),
    ];
    if (moveShowSearch) {
        contentChildren.push(
            Input({
                id: "move-to-filter",
                value: () => moveFilter,
                onChange: (v) => {
                    moveFilter = v;
                },
                placeholder: "Filter destinations…",
                style: { width: { kind: "grow" }, height: { kind: "px", value: 22 } },
            })
        );
    }
    contentChildren.push(
        Scroll({
            id: "move-to-tree",
            style: { gap: 1, height: { kind: "grow" } },
            children: () => moveTreeRows(),
        })
    );
    const content = Col({
        style: { padding: 8, gap: 6, height: { kind: "grow" } },
        children: contentChildren,
    });

    const titleW = Renderer.getStringWidth(`Move '${ctx.identity}' to…`) + 20;
    const width = Math.min(340, Math.max(moveMenuWidth(moveTreeRoots), titleW));

    openPopover({
        anchor: { x: lastMenuX, y: lastMenuY, w: 0, h: 0 },
        excludeAnchor: false,
        content,
        width,
        height,
        key: "move-to",
    });
}

function importableActions(parent: ResultImport, imp: Importable): MenuAction[] {
    const target = importablePreviewPath(parent, imp);
    const item = makeImportableQueueItem(imp, parent.fullPath);
    const extras: MenuAction[] = [
        openInViewAction(target),
        {
            label: "Rename",
            onClick: () => {
                openRenameImportablePopover(
                    { x: 0, y: 0, w: 0, h: 0 },
                    parent.fullPath,
                    imp
                );
            },
        },
        ...(projectHasIncludes(parent)
            ? [
                  {
                      label: "Move to…",
                      icon: Icons.folder,
                      onClick: () => openMoveToMenu(parent, imp),
                  } as MenuAction,
              ]
            : []),
        { kind: "separator" },
        {
            label: "Delete from project…",
            icon: Icons.trash2,
            onClick: () => confirmDeleteImportable(parent, imp),
        },
    ];
    return composeImportableMenu(extras, target, item);
}

function collectSubtreeImportables(node: IncludeNode, out: Importable[]): void {
    for (let i = 0; i < node.includes.length; i++) {
        collectSubtreeImportables(node.includes[i], out);
    }
    for (let i = 0; i < node.importables.length; i++) {
        out.push(node.importables[i]);
    }
}

function queueImportables(parent: ResultImport, importables: readonly Importable[]): void {
    for (let i = 0; i < importables.length; i++) {
        const imp = importables[i];
        addToQueue(makeImportableQueueItem(imp, parent.fullPath));
        const key = importableKey(imp.type, importableIdentity(imp));
        if (!isImportableChecked(key)) toggleImportableChecked(key);
    }
}

function queueImportJsonSubtree(parent: ResultImport, node: IncludeNode): void {
    const importables: Importable[] = [];
    collectSubtreeImportables(node, importables);
    queueImportables(parent, importables);
}

// Where the last row menu opened. Submenus ("Move to…") anchor here because
// a MenuAction's onClick receives no coordinates of its own.
let lastMenuX = 0;
let lastMenuY = 0;

const DISCLOSURE_W = 34;
const QUEUE_W = 28;
const CONTROL_W = 26;
const INNER_GAP = 6;

function typeMarker(color: number): Element {
    return Container({
        style: {
            width: { kind: "px", value: 6 },
            height: { kind: "px", value: 12 },
            background: color,
        },
        children: [],
    });
}

function fileIconFor(r: Result): Element {
    if (r.type === "import") {
        return Icon({ name: Icons.fileJson, color: ACCENT_INFO });
    }
    if (r.type === "script") {
        return Icon({ name: Icons.fileCode, color: IMPORTABLE_TYPE_COLORS.FUNCTION });
    }
    return Icon({ name: Icons.fileBox, color: IMPORTABLE_TYPE_COLORS.ITEM });
}

function caretButton(expanded: boolean, onToggle: () => void, width: number = CONTROL_W): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "px", value: width },
            height: { kind: "grow" },
            align: "center",
            justify: "center",
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: (_rect, info) => {
            if (info.button !== 0) return;
            onToggle();
        },
        children: [
            Icon({
                name: expanded ? Icons.chevronDown : Icons.chevronRight,
            }),
        ],
    });
}

function queueCheckbox(checked: boolean, onToggle: () => void): Element {
    const color = checked ? ACCENT_SUCCESS : COLOR_TEXT_DIM;
    return Container({
        style: {
            direction: "row",
            width: { kind: "px", value: QUEUE_W },
            height: { kind: "grow" },
            align: "center",
            justify: "center",
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: (_rect, info) => {
            if (info.isDoubleClickSecond) return;
            if (info.button !== 0) return;
            onToggle();
        },
        children: [
            Icon({
                name: checked ? Icons.squareCheck : Icons.square,
                color,
                tooltip: checked ? "Queued" : "Add to queue",
                tooltipColor: color,
                style: { width: { kind: "px", value: 12 }, height: { kind: "px", value: 12 } },
            }),
        ],
    });
}

function rowSlot(w: number): Element {
    return Container({
        style: {
            width: { kind: "px", value: w },
            height: { kind: "grow" },
        },
        children: [],
    });
}

function rowHandler(
    actions: MenuAction[],
    defaultLeftAction?: () => void
): (rect: Rect, info: ClickInfo) => void {
    return (_rect, info) => {
        if (info.isDoubleClickSecond) return;
        if (info.button === 1) {
            lastMenuX = info.x;
            lastMenuY = info.y;
            openMenu(info.x, info.y, actions);
            return;
        }
        if (info.button !== 0) return;
        if (defaultLeftAction) defaultLeftAction();
        else {
            lastMenuX = info.x;
            lastMenuY = info.y;
            openMenu(info.x, info.y, actions);
        }
    };
}

const ROOT_DIR_PREFIX = "dir:";

export function dirRootKey(s: SourceDir): string {
    return ROOT_DIR_PREFIX + s.fullPath;
}

export function rootRow(label: string, key: string, actions: MenuAction[]): Element {
    const collapsed = collapsedRoots.has(key);
    return Container({
        style: {
            direction: "row",
            padding: [
                { side: "left", value: 0 },
                { side: "right", value: 6 },
            ],
            gap: 0,
            align: "center",
            height: { kind: "px", value: 18 },
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(actions, () => {
            if (collapsed) collapsedRoots.delete(key);
            else collapsedRoots.add(key);
            bumpTreeRevision();
        }),
        children: [
            Icon({ name: collapsed ? Icons.chevronRight : Icons.chevronDown }),
            Text({ text: label, style: { width: { kind: "grow" } } }),
        ],
    });
}

// The project folder is the directory holding the import.json — opening it
// in VSCode roots the workspace there, so every referenced .htsl is in the tree.
function projectDirOf(importJsonPath: string): string {
    const norm = importJsonPath.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    if (slash < 0) return ".";
    if (slash === 0) return "/";
    if (slash === 2 && norm.charAt(1) === ":") return norm.substring(0, 3);
    return norm.substring(0, slash);
}

// The houseUuid the file declares, via the warm parse cache. Null while the
// parse is cold/pending or the file is unbound — the chip simply doesn't
// render for a frame or two until the cache warms.
function boundHouseUuidOf(fullPath: string): string | null {
    const parse = requestParse(fullPath);
    if (parse === null || parse.parsed === null) return null;
    return parse.parsed.gcx.houseUuid;
}

function rebindFile(fullPath: string, rawUuid: string | null): void {
    const startedAt = Date.now();
    const uuid = rawUuid === null ? null : rawUuid.toLowerCase();
    if (!setHouseUuidKey(fullPath, uuid)) {
        ChatLib.chat(`&c[htsw] Couldn't update ${shortPath(fullPath)}`);
        return;
    }
    const wroteAt = Date.now();
    // A binding edit only changes one metadata key, so don't invalidate the
    // parse — a cold re-parse of a big project freezes the client for its
    // full parse cost. Mirror the on-disk edit into the cached parse instead
    // (the in-place pathway the parse authority supports) and update the
    // reverse index directly, since no re-parse will record it. Only the
    // import.json itself changed, so only its fingerprint entry is touched.
    const entry = getParseAt(fullPath);
    if (entry !== null && entry.parsed !== null) {
        entry.parsed.gcx.houseUuid = uuid;
        touchParseCacheFile(fullPath);
        recordHouseBinding(uuid, canonicalPath(fullPath));
    } else {
        invalidateParseCacheEntry(fullPath);
        requestParse(fullPath);
    }
    const total = Date.now() - startedAt;
    if (total > 250) {
        // Binding should be instant; a slow one means a phase regressed —
        // say which.
        ChatLib.chat(
            `&8[htsw] bind took ${total}ms (file write ${wroteAt - startedAt}ms, cache ${Date.now() - wroteAt}ms)`
        );
    }
    if (uuid !== null) {
        // Binding to the house you're standing in is the same signal as
        // walking into a bound house (state/housing.ts) — point the export
        // destination at the file now rather than on the next uuid change.
        if (uuid === getHousingUuid()) {
            setExportImportJsonPath(fullPath);
        }
        ChatLib.chat(`&a[htsw] Bound ${shortPath(fullPath)} to ${houseDisplayName(uuid)}.`);
    } else {
        ChatLib.chat(`&a[htsw] Removed house binding from ${shortPath(fullPath)}.`);
    }
}

// Binding rewrites the file and changes which house auto-selects it — ask
// before doing either direction.
function confirmRebind(fullPath: string, uuid: string | null): void {
    const bound = boundHouseUuidOf(fullPath);
    if (uuid === null) {
        openConfirmPopover({
            title: `Unbind ${shortPath(fullPath)}?`,
            lines:
                bound !== null
                    ? [`Removes the houseUuid key linking it to ${houseDisplayName(bound)}.`]
                    : [],
            confirmLabel: "Unbind",
            onConfirm: () => rebindFile(fullPath, null),
        });
        return;
    }
    const rebinding = bound !== null && bound !== uuid.toLowerCase();
    const lines = [
        "Writes a houseUuid key into the file; entering",
        `${houseDisplayName(uuid)} then auto-selects it as destination.`,
    ];
    if (rebinding && bound !== null) {
        lines.unshift(`Currently bound to ${houseDisplayName(bound)}.`);
    }
    openConfirmPopover({
        title: `${rebinding ? "Rebind" : "Bind"} ${shortPath(fullPath)} to ${houseDisplayName(uuid)}?`,
        lines,
        confirmLabel: rebinding ? "Rebind" : "Bind",
        onConfirm: () => rebindFile(fullPath, uuid),
    });
}

function houseBindingActions(fullPath: string): MenuAction[] {
    // Same pending guard as houseBindControl: don't offer "Bind to…" on a
    // file whose binding isn't known yet.
    const parse = requestParse(fullPath);
    if (parse === null || parse.parsed === null) return [];
    const bound = parse.parsed.gcx.houseUuid;
    const current = getHousingUuid();
    const actions: MenuAction[] = [];
    if (current !== null && current !== bound) {
        actions.push({
            label: `Bind to ${houseDisplayName(current)}`,
            icon: Icons.house,
            onClick: () => confirmRebind(fullPath, current),
        });
    }
    if (bound !== null) {
        actions.push({
            label: `Unbind from ${houseDisplayName(bound)}`,
            onClick: () => confirmRebind(fullPath, null),
        });
    }
    return actions;
}

// The house-binding control on an import.json header row. Unbound + a house
// detected: a faint house button that binds on click. Bound: the chip shows
// the house (green when you're standing in it) and clicking it opens
// rebind/unbind. A button rather than a context-menu entry — binding is the
// primary way files and houses connect, not a power-user action.
function houseBindControl(fullPath: string): Element | false {
    // A pending parse means "binding unknown", not "unbound" — rendering the
    // gray bind button during the warm-up window made bound files flash an
    // icon-only gray house for a couple of seconds after every load.
    const parse = requestParse(fullPath);
    if (parse === null || parse.parsed === null) return false;
    const bound = parse.parsed.gcx.houseUuid;
    const current = getHousingUuid();
    if (bound === null && current === null) return false;
    if (bound === null && current !== null) {
        return Container({
            style: {
                direction: "row",
                align: "center",
                justify: "center",
                width: { kind: "px", value: 16 },
                height: { kind: "grow" },
                hoverBackground: ROW_HOVER_BG,
            },
            onClick: (_rect, info) => {
                if (info.button !== 0 || info.isDoubleClickSecond) return;
                confirmRebind(fullPath, current);
            },
            children: [
                Icon({
                    name: Icons.house,
                    color: COLOR_TEXT_FAINT,
                    tooltip: `Bind to ${houseDisplayName(current)}`,
                    tooltipColor: COLOR_TEXT_DIM,
                    style: { width: { kind: "px", value: 10 }, height: { kind: "px", value: 10 } },
                }),
            ],
        });
    }
    const boundUuid = bound as string;
    const isHere = boundUuid === current;
    const color = isHere ? ACCENT_SUCCESS : COLOR_TEXT_FAINT;
    const tip = isHere
        ? "Bound to this house (you're in it) — click to change"
        : "Bound house — click to change";
    return Container({
        style: {
            direction: "row",
            gap: 2,
            align: "center",
            padding: { side: "x", value: 2 },
            height: { kind: "grow" },
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: (_rect, info) => {
            if (info.button !== 0 || info.isDoubleClickSecond) return;
            openMenu(info.x, info.y, houseBindingActions(fullPath));
        },
        children: [
            Icon({
                name: Icons.house,
                color,
                tooltip: tip,
                tooltipColor: color,
                style: { width: { kind: "px", value: 9 }, height: { kind: "px", value: 9 } },
            }),
            Text({
                text: houseDisplayName(boundUuid),
                color,
                tooltip: tip,
                tooltipColor: color,
            }),
        ],
    });
}

export function resultRow(
    r: Result,
    sourceKey: string,
    defaultExpanded: boolean,
    extraActions: MenuAction[] = [],
    labelOverride?: string
): Element {
    const isImport = r.type === "import";
    const expKey = expansionKey(sourceKey, r.fullPath);
    const expanded = isImport && isImportExpanded(expKey, defaultExpanded);
    const fileExtras: MenuAction[] = isImport && r.type === "import"
        ? [
              openInViewAction(r.fullPath),
              {
                  label: "Queue all importables",
                  onClick: () => {
                      queueImportJsonSubtree(r, includeTreeOf(r));
                  },
              },
              {
                  label: "Queue all modified",
                  onClick: () => {
                      queueModifiedFromParse(r.fullPath, r.importables);
                  },
              },
              {
                  label: isAutoTrackSource(r.fullPath) ? "Auto-Track: ON" : "Auto-Track: OFF",
                  onClick: () => {
                      const nowOn = toggleAutoTrackSource(r.fullPath);
                      if (nowOn) autoTrackRefresh();
                  },
              },
              {
                  label: "Open project in VSCode",
                  onClick: () => {
                      openInVSCode(projectDirOf(r.fullPath), { newWindow: true });
                  },
              },
              { kind: "separator" },
              {
                  label: "Delete project folder…",
                  icon: Icons.trash2,
                  onClick: () => confirmDeleteProject(r.fullPath),
              },
              ...extraActions,
          ]
        : [openInViewAction(r.fullPath), ...extraActions];
    const actions = composeFileMenu(fileExtras, r.fullPath);
    return Container({
        style: {
            direction: "row",
            padding: [
                { side: "left", value: 0 },
                { side: "right", value: 6 },
            ],
            gap: 0,
            align: "center",
            height: { kind: "px", value: 18 },
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(actions, () => previewSelect(r.fullPath)),
        onDoubleClick: () => confirmSelect(r.fullPath),
        children: [
            isImport
                ? caretButton(expanded, () => {
                      importExpansion.set(expKey, !expanded);
                      bumpTreeRevision();
                  }, DISCLOSURE_W)
                : rowSlot(DISCLOSURE_W),
            fileIconFor(r),
            rowSlot(INNER_GAP),
            Text({
                text: labelOverride ?? r.path,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            isImport && houseBindControl(r.fullPath),
        ],
    });
}

// Label for an include-group ROW: the included file relative to its IMMEDIATE
// parent import.json's directory ("clocks", not "functions/clocks/import.json").
// Indentation already conveys the nesting, so the repeated prefix is just noise.
function includeRowLabel(parentNodePath: string, fullPath: string): string {
    const parentDir = projectDirOf(parentNodePath);
    if (fullPath.indexOf(parentDir + "/") !== 0) return shortPath(fullPath);
    let rel = fullPath.substring(parentDir.length + 1);
    const suffix = "/import.json";
    if (rel.length > suffix.length && rel.lastIndexOf(suffix) === rel.length - suffix.length) {
        rel = rel.substring(0, rel.length - suffix.length);
    }
    return rel;
}

export function includeGroupRow(
    parent: ResultImport,
    node: IncludeNode,
    expKey: string,
    defaultExpanded: boolean,
    parentNodePath: string
): Element {
    const fullPath = canonicalPath(node.path);
    const expanded = isIncludeGroupExpanded(expKey, defaultExpanded);
    const actions = composeFileMenu([
        openInViewAction(fullPath),
        {
            label: "Queue all importables",
            onClick: () => queueImportJsonSubtree(parent, node),
        },
    ], fullPath);
    return Container({
        style: {
            direction: "row",
            padding: [
                { side: "left", value: 0 },
                { side: "right", value: 6 },
            ],
            gap: 0,
            align: "center",
            height: { kind: "px", value: 18 },
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(actions, () => previewSelect(fullPath)),
        onDoubleClick: () => confirmSelect(fullPath),
        children: [
            caretButton(expanded, () => {
                includeGroupExpansion.set(expKey, !expanded);
                bumpTreeRevision();
            }, DISCLOSURE_W),
            Icon({ name: Icons.fileJson, color: ACCENT_INFO }),
            rowSlot(INNER_GAP),
            Text({
                text: includeRowLabel(parentNodePath, fullPath),
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            Text({
                text: String(subtreeImportableCount(node)),
                color: COLOR_TEXT_FAINT,
            }),
        ],
    });
}

/**
 * Severity badge for an importable that has parse diagnostics in its own
 * source: a red octagon for errors (taking precedence), else a yellow
 * triangle for warnings, with the count of the shown severity. The tooltip
 * carries the full breakdown.
 */
function diagnosticBadge(counts: SeverityCounts): Element {
    const isError = counts.errors > 0;
    const color = isError ? ACCENT_DANGER : ACCENT_WARN;
    const name = isError ? Icons.octagonAlert : Icons.triangleAlert;
    const shown = isError ? counts.errors : counts.warnings;
    const tip =
        `${counts.errors} error${counts.errors === 1 ? "" : "s"}, ` +
        `${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}`;
    return Container({
        style: { direction: "row", gap: 2, align: "center" },
        children: [
            Icon({
                name,
                color,
                tooltip: tip,
                tooltipColor: color,
                style: { width: { kind: "px", value: 9 }, height: { kind: "px", value: 9 } },
            }),
            // The MC font digit sits ~1px high in its line box vs the icon's
            // geometric centre; a 1px top pad drops it to match.
            Container({
                style: { padding: { side: "top", value: 1 } },
                children: [
                    Text({
                        text: String(shown),
                        color,
                        tooltip: tip,
                        tooltipColor: color,
                    }),
                ],
            }),
        ],
    });
}

/**
 * Toggle an importable's queue membership from an Importables row. Adding (an
 * unchecked importable → checked) is always allowed, even mid-import — the
 * queue session tracks late adds as "pending" and they survive the run.
 * Removing (checked → unchecked) is blocked while an import is running: the
 * queue is locked so a live run's items can't be yanked out from under it.
 */
function toggleImportableInQueue(
    parent: ResultImport,
    imp: Importable,
    checkKey: string,
    checked: boolean
): void {
    if (checked && isImportRunning()) return; // would remove — locked mid-run
    const nowChecked = toggleImportableChecked(checkKey);
    const item = makeImportableQueueItem(imp, parent.fullPath);
    if (nowChecked) addToQueue(item);
    else removeFromQueueKey(queueItemKey(item));
}

export function importableRow(parent: ResultImport, imp: Importable): Element {
    const previewPath = importablePreviewPath(parent, imp);
    const expandable = isImportableExpandable(imp);
    const expKey = importableExpansionKey(parent.fullPath, imp);
    const expanded = importableExpansion.has(expKey);
    const checkKey = importableKey(imp.type, importableIdentity(imp));
    const checked = isImportableChecked(checkKey);
    const diagCounts = diagnosticCountsFor(parent.parse, imp);
    const showBadge = diagCounts.errors > 0 || diagCounts.warnings > 0;
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "grow" },
            padding: [
                { side: "left", value: 0 },
                { side: "right", value: 3 },
            ],
            gap: 0,
            align: "center",
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(importableActions(parent, imp), () => previewSelect(previewPath)),
        onDoubleClick: () => confirmSelect(previewPath),
        children: [
            queueCheckbox(checked, () => toggleImportableInQueue(parent, imp, checkKey, checked)),
            typeMarker(IMPORTABLE_TYPE_COLORS[imp.type]),
            rowSlot(INNER_GAP),
            importableStatus(imp),
            rowSlot(INNER_GAP),
            imp.type === "FUNCTION" && imp.icon !== undefined &&
                McItem({ item: imp.icon.item, count: imp.icon.count ?? 1 }),
            imp.type === "FUNCTION" && imp.icon !== undefined && rowSlot(INNER_GAP),
            imp.type === "EVENT" && McItem({ item: EVENT_ICONS[imp.event] }),
            imp.type === "EVENT" && rowSlot(INNER_GAP),
            Text({
                text: importableLabel(imp),
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            rowSlot(INNER_GAP),
            showBadge && diagnosticBadge(diagCounts),
            showBadge && rowSlot(INNER_GAP),
            Text({ text: imp.type, color: COLOR_TEXT_DIM }),
            expandable &&
                caretButton(expanded, () => {
                    if (expanded) importableExpansion.delete(expKey);
                    else importableExpansion.add(expKey);
                    bumpTreeRevision();
                }),
        ],
    });
}

export function subRow(parent: ResultImport, imp: Importable, kind: SubListKind): Element {
    const label = SUB_LIST_LABELS[kind];
    const path = importableSubListPath(imp, kind, parent.parse);
    const target = path ?? parent.fullPath;
    const actions = composeFileMenu([openInViewAction(target)], target);
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "grow" },
            padding: { side: "x", value: 3 },
            gap: 0,
            align: "center",
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(actions, () => previewSelect(target)),
        onDoubleClick: () => confirmSelect(target),
        children: [
            Icon({
                name: Icons.fileCode,
                color: IMPORTABLE_TYPE_COLORS[imp.type],
                style: { width: { kind: "px", value: 11 }, height: { kind: "px", value: 11 } },
            }),
            rowSlot(INNER_GAP),
            Text({
                text: label,
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

const DIFF_SYMBOL: { [k in FieldDiff]: string } = { changed: "~", added: "+", removed: "-" };
const DIFF_COLOR: { [k in FieldDiff]: number } = {
    changed: 0xffe5bc4b | 0,
    added: 0xff5cb85c | 0,
    removed: 0xffe85c5c | 0,
};

export function metadataRow(parent: ResultImport, imp: Importable, field: MetadataField): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "grow" },
            padding: { side: "x", value: 3 },
            gap: 6,
            align: "center",
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: (rect, info) => {
            if (info.button !== 0) return;
            openEditFunctionFieldPopover(rect, parent.fullPath, imp, field.key);
        },
        children: [
            field.diff !== undefined
                ? Text({
                      text: DIFF_SYMBOL[field.diff],
                      color: DIFF_COLOR[field.diff],
                      tooltip: field.diff,
                      tooltipColor: DIFF_COLOR[field.diff],
                      style: { width: { kind: "px", value: 8 } },
                  })
                : Text({ text: "", style: { width: { kind: "px", value: 8 } } }),
            Text({
                text: field.label,
                color: COLOR_TEXT_FAINT,
            }),
            Text({
                text: field.value,
                color: field.diff !== undefined ? DIFF_COLOR[field.diff] : COLOR_TEXT_DIM,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

export function standaloneCloseAction(s: SourceFile): MenuAction[] {
    return [{ label: "Close", onClick: () => removeSource(s.fullPath) }];
}
