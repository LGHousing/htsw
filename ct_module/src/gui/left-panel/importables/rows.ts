/// <reference types="../../../../CTAutocomplete" />

import {
    ClickInfo,
    Element,
    Rect,
} from "../../lib/layout";
import { Container, Icon, McItem, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import { openMenu, MenuAction } from "../../lib/menu";
import { openRenameImportablePopover } from "./renameImportablePopover";
import { openConfirmPopover } from "../../popovers/confirm";
import {
    getHousingUuid,
    importableSelectionKey,
    isAutoTrackSource,
    isHouseTrusted,
    isImportableChecked,
    toggleAutoTrackSource,
    toggleImportableChecked,
} from "../../state";
import { ACCENT_DANGER, ACCENT_INFO, ACCENT_SUCCESS, ACCENT_WARN, COLOR_TEXT_DIM, COLOR_TEXT_FAINT } from "../../lib/theme";
import { diagnosticCountsFor, diagnosticCountsForFile, type SeverityCounts } from "htsw";
import { openEditImportableFieldPopover } from "./editFieldPopover";
import { cacheStateForImportable, linkStatusIcon } from "../../cache-status";
import { menuSlotCacheStatus } from "../../cache-status/menuSlotStatus";
import { isScannableType } from "../houses/contentTypes";
import {
    hasChildList,
    importableDeclaringPath,
    importableFilePaths,
    importableSourcePath,
    importableChildListPath,
    type ImportableChildListName,
} from "../../parsing/importablePaths";
import { importableIdentity } from "../../../importables/identity";
import { houseDisplayName } from "../../../importCache/aliases";
import {
    removeImportableEntry,
    removeIncludeFromImportJson,
} from "../../../project/importJsonMutations";
import { countFilesRecursive, deleteDirRecursive } from "../../../utils/filesystem";
import {
    canonicalPath,
    invalidateParseCacheEntry,
    markParseStale,
    requestParse,
} from "../../parsing/parses";
import { shortPath, toForwardSlashes } from "../../lib/pathDisplay";
import {
    houseTypeScanned,
    listCachedImportables,
    readImportableCache,
} from "../../../importCache/cache";
import { functionIconCompareKey } from "../../../importCache/hash";
import { addToQueue, makeImportableQueueItem, queueItemKey, removeFromQueueKey } from "../../right-panel/import-tab/queue";
import { isTaskRunning } from "../../../tasks/runningState";
import { composeFileMenu, composeImportableMenu } from "../../menus/fileMenu";
import { autoTrackRefresh, queueModifiedFromPath, queueModifiedImportables } from "../../autoTrack";
import { SourceDir, SourceFile, removeSource } from "./source";
import { type IncludeNode, findIncludeNode, includeTreeOf, subtreeImportableCount } from "./includeTree";
import {
    showInExplorer,
    openInVSCode,
    revealInFilesLabel,
    setClipboardString,
} from "../../../utils/osShell";
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
    SECTION_BY_TYPE,
    bumpTreeRevision,
    caretButton,
} from "./rowModel";
import { openMoveDestinationPicker } from "./moveDestinationPicker";
import { confirmRebind, houseBindingActions } from "../../houseBinding";
import type { Bounds, Importable, MenuSlot } from "htsw/types";
import { tagChild, type TagLike } from "../../../housingSync/fields/itemTagCanonical";

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
export function expandIncludeGroup(expKey: string): void {
    includeGroupExpansion.set(expKey, true);
}

// Transient highlight on a group row a reference-row jump landed on.
let jumpFlashKey: string | null = null;
let jumpFlashUntil = 0;
export function setJumpFlash(expKey: string): void {
    jumpFlashKey = expKey;
    jumpFlashUntil = Date.now() + 1500;
}
function isJumpFlashing(expKey: string): boolean {
    return jumpFlashKey === expKey && Date.now() < jumpFlashUntil;
}

export const importableExpansion: Set<string> = new Set();
export function importableExpansionKey(parentFullPath: string, imp: Importable): string {
    return `${parentFullPath}::${imp.type}:${importableIdentity(imp)}`;
}

const CHILD_LIST_LABELS: { [k in ImportableChildListName]: string } = {
    actions: "Actions",
    onEnterActions: "Enter actions",
    onExitActions: "Exit actions",
    leftClickActions: "Left click actions",
    rightClickActions: "Right click actions",
};

export function childListsOf(imp: Importable): ImportableChildListName[] {
    if (imp.type === "COMMAND") {
        const out: ImportableChildListName[] = [];
        if (hasChildList(imp, "actions")) out.push("actions");
        return out;
    }
    if (imp.type === "REGION") {
        const out: ImportableChildListName[] = [];
        if (hasChildList(imp, "onEnterActions")) out.push("onEnterActions");
        if (hasChildList(imp, "onExitActions")) out.push("onExitActions");
        return out;
    }
    if (imp.type === "ITEM" || imp.type === "NPC") {
        const out: ImportableChildListName[] = [];
        if (hasChildList(imp, "leftClickActions")) out.push("leftClickActions");
        if (hasChildList(imp, "rightClickActions")) out.push("rightClickActions");
        return out;
    }
    return [];
}

type FieldDiff = "changed" | "added" | "removed";
export type MetadataField = {
    key: string;
    label: string;
    value: string;
    diff?: FieldDiff;
    /** Hover text naming both sides of the diff — a bare marker invites
     *  "why is this a diff?" when the house-side value isn't visible. */
    diffTooltip?: string;
};

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
    if (uuid !== null && imp.type === "EVENT") return "present";
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
    // Items have no house-side listing to scan (not in
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

function showDiffValue(v: unknown): string {
    const j = JSON.stringify(v ?? null);
    if (j === "null") return "(none)";
    return j.length > 60 ? j.substring(0, 57) + "..." : j;
}

function valDiff(
    fileValue: unknown,
    houseValue: unknown
): { diff: FieldDiff; diffTooltip: string } | undefined {
    const aj = JSON.stringify(fileValue ?? null);
    const bj = JSON.stringify(houseValue ?? null);
    if (aj === bj) return undefined;
    const diff: FieldDiff =
        aj === "null" ? "removed" : bj === "null" ? "added" : "changed";
    return {
        diff,
        diffTooltip: `file: ${showDiffValue(fileValue)} — house: ${showDiffValue(houseValue)}`,
    };
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
                ...(cf !== null ? valDiff(imp.repeatTicks, cf.repeatTicks) : undefined),
            },
            {
                key: "icon",
                label: "Icon",
                value: imp.icon !== undefined ? imp.icon.item : "default",
                ...(cf !== null ? valDiff(functionIconCompareKey(imp.icon), functionIconCompareKey(cf.icon)) : undefined),
            },
        ];
        if (imp.icon !== undefined) {
            fields.push({
                key: "iconCount",
                label: "Count",
                value: imp.icon.count !== undefined ? String(imp.icon.count) : "1",
                // count 1 and absent count are the same icon.
                ...(cf !== null ? valDiff(imp.icon.count ?? 1, cf.icon?.count ?? 1) : undefined),
            });
        }
        return fields;
    }
    if (imp.type === "COMMAND") {
        const cc = cached !== null && cached.type === "COMMAND" ? cached : null;
        return [
            {
                key: "mode",
                label: "Mode",
                value: imp.mode ?? "Self",
                ...(cc !== null ? valDiff(imp.mode ?? "Self", cc.mode ?? "Self") : undefined),
            },
            {
                key: "requiredPriority",
                label: "Priority",
                value: String(imp.requiredPriority ?? 0),
                ...(cc !== null ? valDiff(imp.requiredPriority ?? 0, cc.requiredPriority ?? 0) : undefined),
            },
            {
                key: "listed",
                label: "Listed",
                value: (imp.listed ?? true) ? "true" : "false",
                ...(cc !== null ? valDiff(imp.listed ?? true, cc.listed ?? true) : undefined),
            },
        ];
    }
    if (imp.type === "REGION") {
        const cr = cached !== null && cached.type === "REGION" ? cached : null;
        const bounds = imp.bounds as Bounds | undefined;
        const cachedBounds = cr?.bounds;
        if (bounds === undefined) {
            return [
                {
                    key: "bounds",
                    label: "Bounds",
                    value: "(not set)",
                    ...(cr !== null ? valDiff(undefined, cachedBounds) : undefined),
                },
            ];
        }
        return [
            {
                key: "boundsFrom", label: "From", value: formatPos(bounds.from),
                ...(cachedBounds !== undefined ? valDiff(bounds.from, cachedBounds.from) : undefined),
            },
            {
                key: "boundsTo", label: "To", value: formatPos(bounds.to),
                ...(cachedBounds !== undefined ? valDiff(bounds.to, cachedBounds.to) : undefined),
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
                ...(cm !== null ? valDiff(imp.size, cm.size) : undefined),
            },
        ];
    }
    if (imp.type === "NPC") {
        const cn = cached !== null && cached.type === "NPC" ? cached : null;
        return [
            {
                key: "pos",
                label: "Pos",
                value: formatPos(imp.pos),
                ...(cn !== null ? valDiff(imp.pos, cn.pos) : undefined),
            },
            {
                key: "leftClickRedirect",
                label: "Redirect",
                value: imp.leftClickRedirect === undefined
                    ? "default"
                    : imp.leftClickRedirect ? "true" : "false",
                ...(cn !== null ? valDiff(imp.leftClickRedirect, cn.leftClickRedirect) : undefined),
            },
        ];
    }
    if (imp.type === "ITEM") {
        const ci = cached !== null && cached.type === "ITEM" ? cached : null;
        return [
            {
                key: "nbt",
                label: "NBT",
                value: "Item data",
                ...(ci !== null ? valDiff(imp.nbt, ci.nbt) : undefined),
            },
        ];
    }
    return [];
}

function isImportableExpandable(imp: Importable): boolean {
    return childListsOf(imp).length > 0 || metadataFieldsOf(imp).length > 0;
}

function importableLabel(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}

function importableSourceFilePath(parent: ResultImport, imp: Importable): string {
    return importableSourcePath(imp) ?? parent.fullPath;
}

function importablePreviewPath(parent: ResultImport, imp: Importable): string {
    if (imp.type === "ITEM" && parent.parse !== null) {
        return importableDeclaringPath(imp, parent.parse);
    }
    return importableSourceFilePath(parent, imp);
}

// Files this importable owns: its primary source (htsl/snbt), child list htsl
// files, and menu slot .snbt/.htsl files — minus the import.json itself and
// anything another importable in the same project also references (shared
// files survive the delete).
function ownedFilesOf(parent: ResultImport, imp: Importable): string[] {
    const mine = new Set<string>();
    for (const p of importableFilePaths(imp)) {
        if (p !== parent.fullPath) mine.add(p);
    }
    if (mine.size === 0) return [];
    const shared = new Set<string>();
    for (let i = 0; i < parent.importables.length; i++) {
        const other = parent.importables[i];
        if (other === imp) continue;
        for (const p of importableFilePaths(other)) {
            if (mine.has(p)) shared.add(p);
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
            const section = SECTION_BY_TYPE[imp.type];
            if (section === undefined || !removeImportableEntry(parent.fullPath, section, identity)) {
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

function confirmDeleteIncludedProject(parentImportJsonPath: string, includedImportJsonPath: string): void {
    const dir = projectDirOf(includedImportJsonPath);
    const count = countFilesRecursive(dir);
    openConfirmPopover({
        title: "Delete included project folder?",
        lines: [
            shortPath(dir),
            `Removes it from ${shortPath(parentImportJsonPath)} and permanently deletes`,
            `${count} file${count === 1 ? "" : "s"} in the included folder.`,
        ],
        confirmLabel: `Delete ${count} file${count === 1 ? "" : "s"}`,
        danger: true,
        onConfirm: () => {
            if (!removeIncludeFromImportJson(parentImportJsonPath, includedImportJsonPath)) {
                ChatLib.chat(`&c[htsw] Couldn't remove include from ${shortPath(parentImportJsonPath)}.`);
                return;
            }
            const ok = deleteDirRecursive(dir);
            removeSource(includedImportJsonPath);
            closeTabsUnder(dir);
            invalidateParseCacheEntry(parentImportJsonPath);
            invalidateParseCacheEntry(includedImportJsonPath);
            markParseStale(parentImportJsonPath);
            requestParse(parentImportJsonPath);
            bumpTreeRevision();
            if (ok) ChatLib.chat(`&a[htsw] Deleted ${dir}.`);
            else ChatLib.chat(`&c[htsw] Couldn't fully delete ${dir} — check it manually.`);
        },
    });
}

function fsActions(fullPath: string): MenuAction[] {
    return [
        { label: revealInFilesLabel(), onClick: () => showInExplorer(fullPath) },
        {
            label: "Copy path",
            onClick: () => {
                if (setClipboardString(fullPath)) ChatLib.chat("&a[htsw] Copied path.");
            },
        },
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
// menu counterpart to double-clicking the row (single-click only previews).
function openInViewAction(path: string, importJsonPath?: string | null): MenuAction {
    return {
        label: "Open in View",
        icon: Icons.eye,
        onClick: () => confirmSelect(path, importJsonPath),
    };
}

function importableActions(parent: ResultImport, imp: Importable): MenuAction[] {
    const target = importablePreviewPath(parent, imp);
    const item = makeImportableQueueItem(imp, parent.fullPath);
    const extras: MenuAction[] = [
        openInViewAction(target, parent.fullPath),
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
        // Offered even in a project with no includes yet — the picker's
        // "New folder…" row is how the first include gets created.
        ...(parent.parse !== null
            ? [
                  {
                      label: "Move to…",
                      icon: Icons.folder,
                      onClick: () => openMoveDestinationPicker(parent, imp, lastMenuX, lastMenuY),
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
        const key = importableSelectionKey(parent.fullPath, imp.type, importableIdentity(imp));
        if (!isImportableChecked(key)) toggleImportableChecked(key);
    }
}

function queueImportJsonSubtree(parent: ResultImport, node: IncludeNode): void {
    const importables: Importable[] = [];
    collectSubtreeImportables(node, importables);
    queueImportables(parent, importables);
}

function queueModifiedSubtree(parent: ResultImport, node: IncludeNode): void {
    const importables: Importable[] = [];
    collectSubtreeImportables(node, importables);
    queueModifiedImportables(parent.fullPath, importables);
}

// Where the last row menu opened. Submenus ("Move to…") anchor here because
// a MenuAction's onClick receives no coordinates of its own.
let lastMenuX = 0;
let lastMenuY = 0;

const DISCLOSURE_W = 34;
const QUEUE_W = 28;
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
    const bound = parse.parsed.importJson.houseUuid;
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

function autoTrackIndicator(fullPath: string): Element | false {
    if (!isAutoTrackSource(fullPath)) return false;
    return Icon({
        name: Icons.radar,
        color: ACCENT_INFO,
        tooltip: "Auto-Track enabled",
        tooltipColor: ACCENT_INFO,
        style: { width: { kind: "px", value: 10 }, height: { kind: "px", value: 10 } },
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
    const importJsonPath = isImport ? r.fullPath : null;
    const expKey = expansionKey(sourceKey, r.fullPath);
    const expanded = isImport && isImportExpanded(expKey, defaultExpanded);
    const fileExtras: MenuAction[] = isImport && r.type === "import"
        ? [
              openInViewAction(r.fullPath, importJsonPath),
              {
                  label: "Queue all importables",
                  onClick: () => {
                      queueImportJsonSubtree(r, includeTreeOf(r));
                  },
              },
              {
                  label: "Queue all modified",
                  onClick: () => {
                      queueModifiedFromPath(r.fullPath);
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
        : [openInViewAction(r.fullPath, importJsonPath), ...extraActions];
    const actions = composeFileMenu(fileExtras, r.fullPath, importJsonPath);
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
        onClick: rowHandler(actions, () => previewSelect(r.fullPath, importJsonPath)),
        onDoubleClick: () => confirmSelect(r.fullPath, importJsonPath),
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
            isImport && autoTrackIndicator(r.fullPath),
            isImport && isAutoTrackSource(r.fullPath) && rowSlot(INNER_GAP),
            isImport && houseBindControl(r.fullPath),
        ],
    });
}

// Label for an include-group ROW: the included file relative to its IMMEDIATE
// parent import.json's directory ("clocks", "../shared/menus-module").
// Indentation already conveys nesting for downward includes; upward includes
// keep their "../" hops so the cross-folder relationship stays visible.
function includeRowLabel(parentNodePath: string, rootNodePath: string, fullPath: string): string {
    const rel = relativePath(projectDirOf(parentNodePath), fullPath) ??
        relativePath(projectDirOf(rootNodePath), fullPath);
    if (rel === null) return shortPath(fullPath);
    const suffix = "/import.json";
    if (rel.length > suffix.length && rel.lastIndexOf(suffix) === rel.length - suffix.length) {
        return rel.substring(0, rel.length - suffix.length);
    }
    return rel;
}

function relativePath(fromDir: string, fullPath: string): string | null {
    const from = pathSegments(fromDir);
    const to = pathSegments(fullPath);
    if (from.length === 0 || to.length === 0) return null;
    if (from[0].toLowerCase() !== to[0].toLowerCase()) return null;
    let shared = 0;
    while (
        shared < from.length &&
        shared < to.length &&
        from[shared].toLowerCase() === to[shared].toLowerCase()
    ) {
        shared++;
    }
    const out: string[] = [];
    for (let i = shared; i < from.length; i++) out.push("..");
    for (let i = shared; i < to.length; i++) out.push(to[i]);
    return out.length === 0 ? "." : out.join("/");
}

function pathSegments(path: string): string[] {
    return toForwardSlashes(path).split("/").filter((part) => part.length > 0);
}

export function includeGroupRow(
    parent: ResultImport,
    node: IncludeNode,
    expKey: string,
    defaultExpanded: boolean,
    parentNodePath: string,
    onJump?: () => void
): Element {
    if (node.reference === true) {
        return includeReferenceRow(parent, node, parentNodePath, onJump);
    }
    const fullPath = canonicalPath(node.path);
    const expanded = isIncludeGroupExpanded(expKey, defaultExpanded);
    const actions = composeFileMenu([
        openInViewAction(fullPath, parent.fullPath),
        {
            label: "Queue all importables",
            onClick: () => queueImportJsonSubtree(parent, node),
        },
        {
            label: "Queue all modified",
            onClick: () => queueModifiedSubtree(parent, node),
        },
        { kind: "separator" },
        {
            label: "Delete project folder…",
            icon: Icons.trash2,
            onClick: () => confirmDeleteIncludedProject(canonicalPath(parentNodePath), fullPath),
        },
    ], fullPath, parent.fullPath);
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
            background: () => (isJumpFlashing(expKey) ? ROW_HOVER_BG : ROW_BG),
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(actions, () => previewSelect(fullPath, parent.fullPath)),
        onDoubleClick: () => confirmSelect(fullPath, parent.fullPath),
        children: [
            caretButton(expanded, () => {
                includeGroupExpansion.set(expKey, !expanded);
                bumpTreeRevision();
            }, DISCLOSURE_W),
            Icon({ name: Icons.fileJson, color: ACCENT_INFO }),
            rowSlot(INNER_GAP),
            Text({
                text: includeRowLabel(parentNodePath, canonicalPath(parent.fullPath), fullPath),
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

// A repeat include: the file's contents render under its home group
// elsewhere in this tree, so this row is an unexpandable link — click jumps
// to (expands + scrolls to + flashes) that home group.
function includeReferenceRow(
    parent: ResultImport,
    node: IncludeNode,
    parentNodePath: string,
    onJump?: () => void
): Element {
    const fullPath = canonicalPath(node.path);
    const actions = composeFileMenu(
        [openInViewAction(fullPath, parent.fullPath)],
        fullPath,
        parent.fullPath
    );
    const home = findIncludeNode(includeTreeOf(parent), fullPath);
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
        onClick: rowHandler(actions, () => onJump?.()),
        onDoubleClick: () => confirmSelect(fullPath, parent.fullPath),
        children: [
            rowSlot(DISCLOSURE_W),
            Icon({
                name: Icons.cornerUpLeft,
                color: COLOR_TEXT_FAINT,
                tooltip: "Also included here — click to jump to its contents",
            }),
            rowSlot(INNER_GAP),
            Text({
                text: includeRowLabel(parentNodePath, canonicalPath(parent.fullPath), fullPath),
                color: COLOR_TEXT_FAINT,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            home !== null &&
                Text({
                    text: String(subtreeImportableCount(home)),
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
    if (checked && isTaskRunning()) return; // would remove — locked mid-run
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
    const checkKey = importableSelectionKey(parent.fullPath, imp.type, importableIdentity(imp));
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
        onClick: rowHandler(
            importableActions(parent, imp),
            () => previewSelect(previewPath, parent.fullPath)
        ),
        onDoubleClick: () => confirmSelect(previewPath, parent.fullPath),
        children: [
            queueCheckbox(checked, () => toggleImportableInQueue(parent, imp, checkKey, checked)),
            typeMarker(IMPORTABLE_TYPE_COLORS[imp.type]),
            rowSlot(INNER_GAP),
            importableStatus(imp),
            rowSlot(INNER_GAP),
            imp.type === "FUNCTION" && imp.icon !== undefined &&
                McItem({ item: imp.icon.item, count: imp.icon.count ?? 1 }),
            imp.type === "FUNCTION" && imp.icon !== undefined && rowSlot(INNER_GAP),
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

export function childListRow(parent: ResultImport, imp: Importable, kind: ImportableChildListName): Element {
    const label = CHILD_LIST_LABELS[kind];
    const target = importableChildListPath(imp, kind) ?? parent.fullPath;
    const actions = composeFileMenu(
        [openInViewAction(target, parent.fullPath)],
        target,
        parent.fullPath
    );
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
        onClick: rowHandler(actions, () => previewSelect(target, parent.fullPath)),
        onDoubleClick: () => confirmSelect(target, parent.fullPath),
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

export function menuSlotExpansionKey(parent: ResultImport, imp: Importable, slot: MenuSlot): string {
    return `${importableExpansionKey(parent.fullPath, imp)}::slot:${slot.slot}`;
}

export type MenuSlotFileKind = "item" | "actions";

/** The file to open for one side of a menu slot; inline JSON (no `nbtPath` /
 * `actionsPath`) falls back to the import.json that declared the menu. */
function menuSlotFilePath(
    parent: ResultImport,
    imp: Importable,
    slot: MenuSlot,
    kind: MenuSlotFileKind
): string {
    const path = kind === "item" ? slot.nbtPath : slot.actionsPath;
    if (path !== undefined) return path;
    return parent.parse !== null ? importableDeclaringPath(imp, parent.parse) : parent.fullPath;
}

function slotItemId(slot: MenuSlot): string | undefined {
    const id = tagChild(slot.nbt as TagLike, "id");
    return id !== undefined && id.type === "string" ? String(id.value) : undefined;
}

function slotItemLabel(slot: MenuSlot): string {
    const name = tagChild(tagChild(tagChild(slot.nbt as TagLike, "tag"), "display"), "Name");
    if (name !== undefined && name.type === "string" && String(name.value).trim().length > 0) {
        return String(name.value);
    }
    if (slot.nbtPath !== undefined) {
        const base = slot.nbtPath.split("\\").join("/").split("/").pop();
        if (base !== undefined && base.length > 0) return base.replace(/\.snbt$/, "");
    }
    return slotItemId(slot) ?? "";
}

function slotDiagnosticCounts(parent: ResultImport, slot: MenuSlot): SeverityCounts {
    const out = { errors: 0, warnings: 0 };
    const paths = [slot.nbtPath, slot.actionsPath];
    for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (p === undefined) continue;
        const c = diagnosticCountsForFile(parent.parse, p);
        out.errors += c.errors;
        out.warnings += c.warnings;
    }
    return out;
}

export function menuSlotRow(parent: ResultImport, imp: Importable, slot: MenuSlot): Element {
    const expKey = menuSlotExpansionKey(parent, imp, slot);
    const expanded = importableExpansion.has(expKey);
    const target = menuSlotFilePath(parent, imp, slot, slot.actions !== undefined ? "actions" : "item");
    const actions = composeFileMenu(
        [openInViewAction(target, parent.fullPath)],
        target,
        parent.fullPath
    );
    const itemId = slotItemId(slot);
    const diagCounts = slotDiagnosticCounts(parent, slot);
    const showBadge = diagCounts.errors > 0 || diagCounts.warnings > 0;
    const slotStatus = menuSlotCacheStatus(imp, slot);
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
        onClick: rowHandler(actions, () => previewSelect(target, parent.fullPath)),
        onDoubleClick: () => confirmSelect(target, parent.fullPath),
        children: [
            itemId !== undefined
                ? McItem({ item: itemId, count: 1 })
                : Icon({
                      name: Icons.fileCode,
                      color: IMPORTABLE_TYPE_COLORS[imp.type],
                      style: { width: { kind: "px", value: 11 }, height: { kind: "px", value: 11 } },
                  }),
            rowSlot(INNER_GAP),
            slotStatus !== null && linkStatusIcon(slotStatus.key, slotStatus.tooltip),
            slotStatus !== null && rowSlot(INNER_GAP),
            Text({ text: `Slot ${slot.slot}`, color: COLOR_TEXT_FAINT }),
            rowSlot(INNER_GAP),
            Text({
                text: slotItemLabel(slot),
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            showBadge && rowSlot(INNER_GAP),
            showBadge && diagnosticBadge(diagCounts),
            caretButton(expanded, () => {
                if (expanded) importableExpansion.delete(expKey);
                else importableExpansion.add(expKey);
                bumpTreeRevision();
            }),
        ],
    });
}

export function menuSlotFileRow(
    parent: ResultImport,
    imp: Importable,
    slot: MenuSlot,
    kind: MenuSlotFileKind
): Element {
    const target = menuSlotFilePath(parent, imp, slot, kind);
    const inline = (kind === "item" ? slot.nbtPath : slot.actionsPath) === undefined;
    const actions = composeFileMenu(
        [openInViewAction(target, parent.fullPath)],
        target,
        parent.fullPath
    );
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
        onClick: rowHandler(actions, () => previewSelect(target, parent.fullPath)),
        onDoubleClick: () => confirmSelect(target, parent.fullPath),
        children: [
            Icon({
                name: Icons.fileCode,
                color: IMPORTABLE_TYPE_COLORS[kind === "item" ? "ITEM" : imp.type],
                style: { width: { kind: "px", value: 11 }, height: { kind: "px", value: 11 } },
            }),
            rowSlot(INNER_GAP),
            Text({ text: kind === "item" ? "Item" : "Actions", color: COLOR_TEXT_DIM }),
            rowSlot(INNER_GAP),
            Text({
                text: inline ? "inline" : shortPath(target),
                color: COLOR_TEXT_FAINT,
                truncate: true,
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
    const fileTarget = imp.type === "ITEM" && field.key === "nbt"
        ? importableSourceFilePath(parent, imp)
        : null;
    const editable = !(imp.type === "NPC" && field.key === "pos");
    const actions = fileTarget === null
        ? null
        : composeFileMenu(
              [openInViewAction(fileTarget, parent.fullPath)],
              fileTarget,
              parent.fullPath
          );
    const value = fileTarget === null ? field.value : shortPath(fileTarget);
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
        onClick: !editable
            ? undefined
            : fileTarget === null || actions === null
            ? (rect, info) => {
                  if (info.button !== 0) return;
                  openEditImportableFieldPopover(rect, parent.fullPath, imp, field.key);
              }
            : rowHandler(actions, () => previewSelect(fileTarget, parent.fullPath)),
        onDoubleClick:
            fileTarget === null ? undefined : () => confirmSelect(fileTarget, parent.fullPath),
        children: [
            field.diff !== undefined
                ? Text({
                      text: DIFF_SYMBOL[field.diff],
                      color: DIFF_COLOR[field.diff],
                      tooltip: field.diffTooltip ?? field.diff,
                      tooltipColor: DIFF_COLOR[field.diff],
                      style: { width: { kind: "px", value: 8 } },
                  })
                : Text({ text: "", style: { width: { kind: "px", value: 8 } } }),
            Text({
                text: field.label,
                color: COLOR_TEXT_FAINT,
            }),
            Text({
                text: value,
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
