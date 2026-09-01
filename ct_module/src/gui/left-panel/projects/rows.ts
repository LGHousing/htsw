/// <reference types="../../../../CTAutocomplete" />

import { ClickInfo, Element, Rect } from "../../lib/layout";
import { Button, Container, Icon, McItem, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import { openMenu, MenuAction } from "../../lib/menu";
import { openRenameImportablePopover } from "./renameImportablePopover";
import { openConfirmPopover } from "../../popovers/confirm";
import {
    getHousingUuid,
    isAutoTrackSource,
    isCurrentHouseTrusted,
    toggleAutoTrackSource,
} from "../../state";
import {
    ACCENT_DANGER,
    ACCENT_INFO,
    ACCENT_SUCCESS,
    ACCENT_WARN,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
} from "../../lib/theme";
import { diagnosticCountsFor, diagnosticCountsForFile, type SeverityCounts } from "htsw";
import { BoundedMap } from "../../lib/boundedLruMap";
import { openEditImportableFieldPopover } from "./editFieldPopover";
import {
    cachedImportableLinkStatus,
    importableLinkStatusContextKey,
    linkStatusIcon,
} from "../../cache-status";
import { menuSlotCacheStatus } from "../../cache-status/menuSlotStatus";
import { requestImportableCacheWarm } from "../../cache-status/cacheWarm";
import {
    hasChildList,
    importableDeclaringPath,
    importableSourcePath,
    importableChildListPath,
    type ImportableChildListName,
} from "../../parsing/importablePaths";
import { importableIdentity } from "../../../importables/identity";
import { houseDisplayName } from "../../../importCache/aliases";
import {
    planDeleteImportableEntry,
    removeImportableEntryForDelete,
    removeIncludeFromImportJson,
} from "../../../project/importJsonMutations";
import { countFilesRecursive, deleteDirRecursive } from "../../../utils/filesystem";
import {
    canonicalPath,
    invalidateParseCacheEntry,
    markParseStale,
    requestParse,
} from "../../parsing/parses";
import { shortPath } from "../../lib/pathDisplay";
import { peekImportableCache } from "../../../importCache/cache";
import {
    importableMetadataComparisonValue,
    importableMetadataEntries,
    normalizePathSeparators,
} from "htsw-editor-common/project";
import {
    addQueueRow,
    addToQueue,
    isQueueItemQueued,
    makeBulkQueueRow,
    makeImportableQueueRow,
    queueItemKey,
    removeFromQueue,
    removeFromQueueKey,
    toggleQueue,
} from "../../right-panel/import-tab/queue";
import { isTaskRunning } from "../../../tasks/runningState";
import { composeFileMenu } from "../../menus/fileMenu";
import { autoTrackRefresh, needsModifiedQueue } from "../../autoTrack";
import { autoRunQueueChanged } from "../../autoRun";
import { autoTrackBlock, autoTrackBoundHouse } from "../../autoTrackScope";
import { SourceDir, SourceFile, removeSource } from "./source";
import {
    type IncludeNode,
    findIncludeNode,
    includeTreeOf,
    subtreeImportableCount,
} from "./includeTree";
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
import { acceptHouseLockMenuAction } from "./acceptHouseLock";
import { confirmRebind, houseBindingActions } from "../../houseBinding";
import type { Importable, MenuSlot } from "htsw/types";
import { tagChild } from "../../../housingSync/items/itemTag";
import { ImportableIcon } from "../../importableVisuals";
import { houseContentTypeFor } from "../houses/contentTypes";
import { itemChanges } from "../../../importables/items/changes";
import { showToast } from "../../toast";
import { HOUSE_READERS } from "../../../importables/export/readers";
import { startDeepRead, type DeepReadSpec } from "../../knowledge/deepRead";
import { importableMatchesFilters } from "./filter";

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
export function expandImport(expKey: string): void {
    importExpansion.set(expKey, true);
}
export const collapsedRoots: Set<string> = new Set();

// Include-group rows (included import.jsons rendered as nested groups under
// the entry file). Explicit toggles win over the default the tree passes in
// (collapsed normally, expanded while a search/type filter narrows).
const includeGroupExpansion: Map<string, boolean> = new Map();
export function includeGroupKey(entryFullPath: string, nodeFullPath: string): string {
    return `${entryFullPath}::${nodeFullPath}`;
}
export function isIncludeGroupExpanded(
    expKey: string,
    defaultExpanded: boolean
): boolean {
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

// ── Workspace capture / restore ────────────────────────────────────────
// Which rows the user had open. `autoExpandPaths` and the jump flash are
// deliberately excluded: both are momentary reactions to an action taken in
// this session, and restoring them would re-fire an effect nobody asked for.

export type ExpansionState = {
    imports: Record<string, boolean>;
    includeGroups: Record<string, boolean>;
    importables: string[];
    collapsedRoots: string[];
};

function recordOfMap(map: Map<string, boolean>): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    map.forEach((value, key) => {
        out[key] = value;
    });
    return out;
}

function fillMap(map: Map<string, boolean>, source: Record<string, boolean>): void {
    map.clear();
    for (const key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        if (typeof source[key] === "boolean") map.set(key, source[key]);
    }
}

function fillSet(set: Set<string>, source: readonly string[]): void {
    set.clear();
    for (let i = 0; i < source.length; i++) {
        if (typeof source[i] === "string") set.add(source[i]);
    }
}

export function getExpansionState(): ExpansionState {
    const importables: string[] = [];
    const roots: string[] = [];
    importableExpansion.forEach((key) => importables.push(key));
    collapsedRoots.forEach((key) => roots.push(key));
    importables.sort();
    roots.sort();
    return {
        imports: recordOfMap(importExpansion),
        includeGroups: recordOfMap(includeGroupExpansion),
        importables,
        collapsedRoots: roots,
    };
}

export function setExpansionState(state: ExpansionState): void {
    fillMap(importExpansion, state.imports);
    fillMap(includeGroupExpansion, state.includeGroups);
    fillSet(importableExpansion, state.importables);
    fillSet(collapsedRoots, state.collapsedRoots);
    bumpTreeRevision();
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

function getCachedImportable(imp: Importable): Importable | null {
    const uuid = getHousingUuid();
    if (uuid === null) return null;
    const cached = peekImportableCache(uuid, imp.type, importableIdentity(imp));
    if (!cached.loaded) {
        requestImportableCacheWarm(uuid, imp);
        return null;
    }
    return cached.entry === null ? null : cached.entry.importable;
}

function importableStatus(imp: Importable): Element | false {
    const status = cachedImportableLinkStatus(imp);
    return status === null ? false : linkStatusIcon(status.key, status.tooltip);
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
    if (imp.type === "ITEM") {
        const cachedItem = cached !== null && cached.type === "ITEM" ? cached : null;
        if (cachedItem === null) {
            const fields: MetadataField[] = [
                { key: "nbt", label: "NBT", value: "Item data" },
            ];
            if (cachedImportableLinkStatus(imp)?.key === "differs") {
                fields.push({
                    key: "legacyDiff",
                    label: "Diff",
                    value: "Previous details unavailable",
                    diff: "changed",
                    diffTooltip:
                        "The older cache recorded only an item fingerprint, not its NBT or actions",
                });
            }
            return fields;
        }
        const changes = itemChanges(imp, cachedItem);
        return [
            {
                key: "nbt",
                label: "NBT",
                value: "Item data",
                ...(changes.nbt.length === 0
                    ? {}
                    : {
                          diff: "changed" as const,
                          diffTooltip: changes.nbt.join(" | "),
                      }),
            },
        ];
    }

    return importableMetadataEntries(imp).map((entry) => ({
        key: entry.key,
        label: entry.label,
        value: entry.value,
        ...(cached === null
            ? undefined
            : valDiff(
                  importableMetadataComparisonValue(imp, entry.key),
                  importableMetadataComparisonValue(cached, entry.key)
              )),
    }));
}
function isImportableExpandable(imp: Importable): boolean {
    return (
        childListsOf(imp).length > 0 ||
        imp.type === "ITEM" ||
        importableMetadataEntries(imp).length > 0
    );
}

function importableLabel(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}

function projectImportQueueRow(parent: ResultImport, imp: Importable) {
    return makeImportableQueueRow({
        op: "import",
        house: parent.parse?.importJson.houseUuid ?? null,
        path: parent.fullPath,
        type: imp.type,
        identity: importableIdentity(imp),
        label: importableLabel(imp),
    });
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

function confirmDeleteImportable(parent: ResultImport, imp: Importable): void {
    const identity = importableIdentity(imp);
    const section = SECTION_BY_TYPE[imp.type];
    if (section === undefined) return;
    const plan = planDeleteImportableEntry(parent.fullPath, section, identity);
    if (!plan.ok) {
        ChatLib.chat(`&c[htsw] ${plan.message}`);
        return;
    }
    const files = plan.ownedFiles;
    const lines = [`Removes the ${imp.type} entry from import.json.`];
    for (let i = 0; i < Math.min(files.length, 4); i++) {
        lines.push(`Deletes ${shortPath(files[i])}`);
    }
    if (files.length > 4) lines.push(`…and ${files.length - 4} more files`);
    lines.push("Deletes nested import.json files only if they become empty.");
    openConfirmPopover({
        title: `Delete "${identity}" from the project?`,
        lines,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: () => {
            const result = removeImportableEntryForDelete(
                parent.fullPath,
                section,
                identity
            );
            if (!result.ok) {
                ChatLib.chat(`&c[htsw] ${result.message}`);
                return;
            }
            for (let i = 0; i < result.ownedFiles.length; i++) {
                const filePath = result.ownedFiles[i];
                try {
                    FileLib.delete(filePath);
                } catch (_e) {
                    ChatLib.chat(`&e[htsw] Couldn't delete ${shortPath(filePath)}`);
                }
                closeTab(filePath);
            }
            for (let i = 0; i < result.prunedImportJsonFiles.length; i++) {
                closeTab(result.prunedImportJsonFiles[i]);
            }
            removeFromQueueKey(queueItemKey(projectImportQueueRow(parent, imp)));
            markParseStale(parent.fullPath);
            requestParse(parent.fullPath);
            bumpTreeRevision();
            ChatLib.chat(
                `&a[htsw] Deleted '${identity}' from ${shortPath(parent.fullPath)}.`
            );
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
            else
                ChatLib.chat(
                    `&c[htsw] Couldn't fully delete ${dir} — check it manually.`
                );
        },
    });
}

function confirmDeleteIncludedProject(
    parentImportJsonPath: string,
    includedImportJsonPath: string
): void {
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
            if (
                !removeIncludeFromImportJson(parentImportJsonPath, includedImportJsonPath)
            ) {
                ChatLib.chat(
                    `&c[htsw] Couldn't remove include from ${shortPath(parentImportJsonPath)}.`
                );
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
            else
                ChatLib.chat(
                    `&c[htsw] Couldn't fully delete ${dir} — check it manually.`
                );
        },
    });
}

function fsActions(fullPath: string): MenuAction[] {
    return [
        {
            label: revealInFilesLabel(),
            icon: Icons.folderOpen,
            onClick: () => showInExplorer(fullPath),
        },
        {
            label: "Copy path",
            icon: Icons.copy,
            onClick: () => {
                if (setClipboardString(fullPath)) ChatLib.chat("&a[htsw] Copied path.");
            },
        },
        {
            label: "Open with VSCode",
            icon: Icons.codeXml,
            onClick: () => openInVSCode(fullPath),
        },
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

function openInHousingAction(imp: Importable): MenuAction | null {
    const uuid = getHousingUuid();
    if (uuid === null) return null;
    const contentType = houseContentTypeFor(imp.type);
    if (contentType === null) return null;
    const identity = importableIdentity(imp);
    const houseItems = contentType.items(uuid);
    let present = false;
    for (let i = 0; i < houseItems.length; i++) {
        if (houseItems[i].name === identity) {
            present = true;
            break;
        }
    }
    if (!present) return null;
    const actions = contentType.rowActions ?? [];
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (!action.opensEditor) continue;
        return {
            label: "Open in Housing",
            icon: Icons.house,
            onClick: () => action.run(identity),
        };
    }
    return null;
}

function projectBindingWarning(parent: ResultImport): string[] {
    const bound = parent.parse?.importJson.houseUuid ?? null;
    const current = getHousingUuid();
    return bound !== null && current !== null && bound !== current
        ? ["You are standing in a different house than this project is bound to."]
        : [];
}

function runProjectReExport(
    parent: ResultImport,
    importJsonPath: string,
    _importables: readonly Importable[]
): void {
    const result = addQueueRow(
        makeBulkQueueRow({
            op: "export",
            house: parent.parse?.importJson.houseUuid ?? getHousingUuid(),
            path: importJsonPath,
            scope: { kind: "file", path: importJsonPath },
            filter: "all",
            label: `Re-export ${shortPath(importJsonPath)}`,
        })
    );
    if (result.kind === "duplicate" || result.kind === "absorbed") {
        showToast(result.message, ACCENT_WARN);
        return;
    }
    showToast(`Queued re-export → ${shortPath(importJsonPath)}`, ACCENT_INFO);
    autoRunQueueChanged();
}

function confirmProjectReExport(
    parent: ResultImport,
    importJsonPath: string,
    importables: readonly Importable[]
): void {
    const count = houseExportCount(importables);
    openConfirmPopover({
        title: `Re-export ${count} declared from the house?`,
        lines: [
            `Overwrites the local file${count === 1 ? "" : "s"} with the house version${count === 1 ? "" : "s"}.`,
            ...projectBindingWarning(parent),
        ],
        confirmLabel: "Re-export",
        danger: true,
        onConfirm: () => runProjectReExport(parent, importJsonPath, importables),
    });
}

function reExportImportableAction(
    parent: ResultImport,
    imp: Importable
): MenuAction | null {
    if (imp.type === "ITEM") return null;
    return {
        label: "Re-export from house",
        icon: Icons.refreshCw,
        disabled: () => getHousingUuid() === null,
        onClick: () => {
            openConfirmPopover({
                title: "Re-export 1 declared from the house?",
                lines: [
                    "Overwrites the local file with the house version.",
                    ...projectBindingWarning(parent),
                ],
                confirmLabel: "Re-export",
                danger: true,
                onConfirm: () => runSingleImportableReExport(parent, imp),
            });
        },
    };
}

function deepReadSpecs(importables: readonly Importable[]): DeepReadSpec[] {
    const namesByType = new Map<Importable["type"], string[]>();
    for (let i = 0; i < importables.length; i++) {
        const imp = importables[i];
        if (HOUSE_READERS[imp.type] === null) continue;
        const names = namesByType.get(imp.type) ?? [];
        names.push(importableIdentity(imp));
        namesByType.set(imp.type, names);
    }
    const specs: DeepReadSpec[] = [];
    namesByType.forEach((names, type) => {
        const read = HOUSE_READERS[type];
        if (read === null) return;
        specs.push({ type, label: type.toLowerCase(), names });
    });
    return specs;
}

function hasModifiedForQueue(importables: readonly Importable[]): boolean {
    for (let i = 0; i < importables.length; i++) {
        if (needsModifiedQueue(importables[i])) return true;
    }
    return false;
}

function queueModifiedAction(
    importables: readonly Importable[],
    onClick: () => void
): MenuAction[] {
    if (!hasModifiedForQueue(importables)) return [];
    return [
        {
            label: `Queue modified for import (${modifiedQueueCount(importables)})`,
            icon: Icons.listChecks,
            onClick,
        },
    ];
}

function modifiedQueueCount(importables: readonly Importable[]): number {
    let count = 0;
    for (let i = 0; i < importables.length; i++) {
        if (needsModifiedQueue(importables[i])) count++;
    }
    return count;
}

function subtreeImportables(node: IncludeNode): Importable[] {
    if (node.reference === true) return [];
    const importables = node.importables.slice();
    for (let i = 0; i < node.includes.length; i++) {
        importables.push(...subtreeImportables(node.includes[i]));
    }
    return importables;
}

function filteredSubtreeImportables(
    parent: ResultImport,
    node: IncludeNode
): Importable[] {
    const importables = subtreeImportables(node);
    const filtered: Importable[] = [];
    for (let i = 0; i < importables.length; i++) {
        if (importableMatchesFilters(importables[i], parent.path, searchQuery)) {
            filtered.push(importables[i]);
        }
    }
    return filtered;
}

function houseExportCount(importables: readonly Importable[]): number {
    let count = 0;
    for (let i = 0; i < importables.length; i++) {
        if (importables[i].type !== "ITEM") count++;
    }
    return count;
}

function deepReadableCount(importables: readonly Importable[]): number {
    let count = 0;
    for (let i = 0; i < importables.length; i++) {
        if (HOUSE_READERS[importables[i].type] !== null) count++;
    }
    return count;
}

function runProjectDeepRead(
    parent: ResultImport,
    importJsonPath: string,
    _importables: readonly Importable[]
): void {
    const housingUuid = getHousingUuid();
    if (housingUuid === null) return;
    const result = addQueueRow(
        makeBulkQueueRow({
            op: "read",
            house: housingUuid,
            path: importJsonPath,
            scope: { kind: "file", path: importJsonPath },
            filter: "all",
            label: `Read ${shortPath(importJsonPath)}`,
        })
    );
    if (result.kind === "duplicate" || result.kind === "absorbed") {
        showToast(result.message, ACCENT_WARN);
        return;
    }
    showToast(`Queued read → ${shortPath(importJsonPath)}`, ACCENT_INFO);
    autoRunQueueChanged();
}

function readImportableAction(parent: ResultImport, imp: Importable): MenuAction | null {
    if (HOUSE_READERS[imp.type] === null) return null;
    return {
        label: "Read from house",
        icon: Icons.scanEye,
        disabled: () => getHousingUuid() === null,
        onClick: () => {
            const housingUuid = getHousingUuid();
            if (housingUuid === null) return;
            startDeepRead(deepReadSpecs([imp]), {
                housingUuid,
                importJsonPath: parent.fullPath,
                parsed: parent.parse,
                summaryLabel: "declared importable",
                onSuccess: bumpTreeRevision,
            });
        },
    };
}

function runSingleImportableReExport(parent: ResultImport, imp: Importable): void {
    const result = addQueueRow(
        makeImportableQueueRow({
            op: "export",
            house: getHousingUuid(),
            path: parent.fullPath,
            type: imp.type,
            identity: importableIdentity(imp),
            label: importableLabel(imp),
        })
    );
    if (result.kind === "duplicate" || result.kind === "absorbed") {
        showToast(result.message, ACCENT_WARN);
        return;
    }
    showToast(`Queued re-export: ${importableLabel(imp)}`, ACCENT_INFO);
    autoRunQueueChanged();
}

function importableActions(parent: ResultImport, imp: Importable): MenuAction[] {
    const target = importablePreviewPath(parent, imp);
    const item = projectImportQueueRow(parent, imp);
    const housingAction = openInHousingAction(imp);
    const reExport = reExportImportableAction(parent, imp);
    const deepRead = readImportableAction(parent, imp);
    const actions: MenuAction[] = [
        {
            label: isQueueItemQueued(item) ? "Remove from queue" : "Queue for import",
            icon: Icons.listPlus,
            onClick: () => {
                if (toggleQueue(item)) autoRunQueueChanged();
            },
        },
        ...(reExport !== null ? [reExport] : []),
        ...(deepRead !== null ? [deepRead] : []),
        { kind: "separator" },
        openInViewAction(target, parent.fullPath),
        ...(housingAction !== null ? [housingAction] : []),
        { kind: "separator" },
        {
            label: "Rename",
            icon: Icons.pencil,
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
                      icon: Icons.folderInput,
                      onClick: () =>
                          openMoveDestinationPicker(parent, imp, lastMenuX, lastMenuY),
                  } as MenuAction,
              ]
            : []),
        ...fsActions(target),
        { kind: "separator" },
        {
            label: "Delete from project…",
            icon: Icons.trash2,
            onClick: () => confirmDeleteImportable(parent, imp),
        },
    ];
    return actions;
}

function collectSubtreeImportables(node: IncludeNode, out: Importable[]): void {
    for (let i = 0; i < node.includes.length; i++) {
        collectSubtreeImportables(node.includes[i], out);
    }
    for (let i = 0; i < node.importables.length; i++) {
        out.push(node.importables[i]);
    }
}

type SubtreeAggregate = { changed: number; errors: number };
type CachedSubtreeAggregate = SubtreeAggregate & {
    parse: object | null;
    statusKey: string;
};

const subtreeAggregateCache = new BoundedMap<string, CachedSubtreeAggregate>(256);

export function subtreeAggregateCacheSize(): number {
    return subtreeAggregateCache.size;
}

// Recomputed only when the parse or the warmed status context changes — the
// per-importable sweep here is what regressed GUI performance when it ran on
// a timer (see f92fe28); keying on the status revision keeps the changed
// count without the per-frame cost.
function subtreeAggregate(parent: ResultImport, node: IncludeNode): SubtreeAggregate {
    const key = canonicalPath(node.path);
    const statusKey = importableLinkStatusContextKey();
    const cached = subtreeAggregateCache.get(key);
    if (
        cached !== undefined &&
        cached.parse === parent.parse &&
        cached.statusKey === statusKey
    ) {
        return cached;
    }
    const importables: Importable[] = [];
    collectSubtreeImportables(node, importables);
    let changed = 0;
    let errors = 0;
    for (let i = 0; i < importables.length; i++) {
        const imp = importables[i];
        if (needsModifiedQueue(imp)) changed++;
        errors += diagnosticCountsFor(parent.parse, imp).errors;
    }
    const aggregate = { changed, errors, parse: parent.parse, statusKey };
    subtreeAggregateCache.set(key, aggregate);
    return aggregate;
}

function changedAggregate(count: number): Element {
    const tooltip = `${count} will change on import`;
    return Container({
        style: { direction: "row", gap: 2, align: "center" },
        children: [
            Container({
                style: {
                    width: { kind: "px", value: 5 },
                    height: { kind: "px", value: 5 },
                    background: ACCENT_WARN,
                },
                tooltip,
                tooltipColor: ACCENT_WARN,
                children: [],
            }),
            Text({
                text: String(count),
                color: ACCENT_WARN,
                tooltip,
                tooltipColor: ACCENT_WARN,
            }),
        ],
    });
}

function errorAggregate(count: number): Element {
    const tooltip = count === 1 ? "1 error inside" : `${count} errors inside`;
    return Container({
        style: { direction: "row", gap: 2, align: "center" },
        children: [
            Icon({
                name: Icons.octagonAlert,
                color: ACCENT_DANGER,
                tooltip,
                tooltipColor: ACCENT_DANGER,
                style: {
                    width: { kind: "px", value: 9 },
                    height: { kind: "px", value: 9 },
                },
            }),
            Container({
                style: { padding: { side: "top", value: 1 } },
                children: [
                    Text({
                        text: String(count),
                        color: ACCENT_DANGER,
                        tooltip,
                        tooltipColor: ACCENT_DANGER,
                    }),
                ],
            }),
        ],
    });
}

function collapsedSubtreeAggregates(parent: ResultImport, node: IncludeNode): Element[] {
    const aggregate = subtreeAggregate(parent, node);
    const out: Element[] = [];
    if (isCurrentHouseTrusted() && aggregate.changed > 0) {
        out.push(changedAggregate(aggregate.changed), rowSlot(INNER_GAP));
    }
    if (aggregate.errors > 0) {
        out.push(errorAggregate(aggregate.errors), rowSlot(INNER_GAP));
    }
    return out;
}

function queueImportables(
    parent: ResultImport,
    scopePath: string,
    _importables: readonly Importable[]
): void {
    const result = addQueueRow(
        makeBulkQueueRow({
            op: "import",
            house: parent.parse?.importJson.houseUuid ?? null,
            path: parent.fullPath,
            scope: { kind: "file", path: scopePath },
            filter: "all",
            label: `Import ${shortPath(scopePath)}`,
        })
    );
    if (result.kind === "duplicate" || result.kind === "absorbed") {
        showToast(result.message, ACCENT_WARN);
        return;
    }
    showToast(`Queued import → ${shortPath(scopePath)}`, ACCENT_INFO);
    autoRunQueueChanged();
}

function queueModifiedSubtree(
    parent: ResultImport,
    scopePath: string,
    _importables: readonly Importable[]
): void {
    if (parent.parse === null) return;
    const result = addQueueRow(
        makeBulkQueueRow({
            op: "import",
            house: parent.parse.importJson.houseUuid,
            path: parent.fullPath,
            scope: { kind: "file", path: scopePath },
            filter: "modified",
            label: `Import modified in ${shortPath(scopePath)}`,
        })
    );
    if (result.kind === "duplicate" || result.kind === "absorbed") {
        showToast(result.message, ACCENT_WARN);
        return;
    }
    showToast(`Queued modified import → ${shortPath(scopePath)}`, ACCENT_INFO);
    autoRunQueueChanged();
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

function queueCheckbox(
    checked: () => boolean,
    onToggle: (checked: boolean) => void
): Element {
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
            onToggle(checked());
        },
        tooltip: () => (checked() ? "Queued" : "Add to queue"),
        tooltipColor: () => (checked() ? ACCENT_SUCCESS : COLOR_TEXT_DIM),
        children: [
            Icon({
                name: () => (checked() ? Icons.squareCheck : Icons.square),
                color: () => (checked() ? ACCENT_SUCCESS : COLOR_TEXT_DIM),
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                },
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

type RowActions = MenuAction[] | (() => MenuAction[]);

function resolveRowActions(actions: RowActions): MenuAction[] {
    return typeof actions === "function" ? actions() : actions;
}

function rowMenuButton(actions: RowActions, key: string): Element {
    return Button({
        style: {
            width: { kind: "px", value: 16 },
            height: { kind: "grow" },
            padding: 0,
            background: 0x00000000,
            hoverBackground: ROW_HOVER_BG,
        },
        tooltip: "More actions",
        onClick: (rect, info) => {
            if (info.button !== 0 || info.isDoubleClickSecond) return;
            lastMenuX = rect.x + rect.w;
            lastMenuY = rect.y;
            openMenu(rect.x + rect.w, rect.y, resolveRowActions(actions), {
                key: `project-row:${key}`,
                trigger: rect,
            });
        },
        children: [
            Icon({
                name: Icons.ellipsisVertical,
                color: COLOR_TEXT_FAINT,
                style: {
                    width: { kind: "px", value: 11 },
                    height: { kind: "px", value: 11 },
                },
            }),
        ],
    });
}

function rowHandler(
    actions: RowActions,
    defaultLeftAction?: () => void
): (rect: Rect, info: ClickInfo) => void {
    return (_rect, info) => {
        if (info.isDoubleClickSecond) return;
        if (info.button === 1) {
            lastMenuX = info.x;
            lastMenuY = info.y;
            openMenu(info.x, info.y, resolveRowActions(actions));
            return;
        }
        if (info.button !== 0) return;
        if (defaultLeftAction) defaultLeftAction();
        else {
            lastMenuX = info.x;
            lastMenuY = info.y;
            openMenu(info.x, info.y, resolveRowActions(actions));
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
            tooltip: `Bind to ${houseDisplayName(current)}`,
            tooltipColor: COLOR_TEXT_DIM,
            children: [
                Icon({
                    name: Icons.house,
                    color: COLOR_TEXT_FAINT,
                    style: {
                        width: { kind: "px", value: 10 },
                        height: { kind: "px", value: 10 },
                    },
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
        tooltip: tip,
        tooltipColor: color,
        children: [
            Icon({
                name: Icons.house,
                color,
                style: {
                    width: { kind: "px", value: 9 },
                    height: { kind: "px", value: 9 },
                },
            }),
            Text({
                text: houseDisplayName(boundUuid),
                color,
            }),
        ],
    });
}

function parsePendingIndicator(r: Result): Element | false {
    if (r.type !== "import" || r.parse !== null || !r.parsePending) return false;
    return Text({
        text: () => `parsing${".".repeat(1 + (Math.floor(Date.now() / 350) % 3))}`,
        color: COLOR_TEXT_DIM,
    });
}

function autoTrackPausedTooltip(fullPath: string): string {
    if (autoTrackBlock(fullPath) === "unbound") {
        return "Auto-Track paused — this project isn't bound to a house";
    }
    const bound = autoTrackBoundHouse(fullPath);
    return bound === null
        ? "Auto-Track paused — you're not in the bound house"
        : `Auto-Track paused — you're not in ${houseDisplayName(bound)}`;
}

function autoTrackIndicator(fullPath: string): Element | false {
    if (!isAutoTrackSource(fullPath)) return false;
    const active = (): boolean => autoTrackBlock(fullPath) === null;
    return Icon({
        name: Icons.radar,
        color: () => (active() ? ACCENT_INFO : COLOR_TEXT_FAINT),
        tooltip: () =>
            active() ? "Auto-Track enabled" : autoTrackPausedTooltip(fullPath),
        tooltipColor: () => (active() ? ACCENT_INFO : COLOR_TEXT_DIM),
        style: { width: { kind: "px", value: 10 }, height: { kind: "px", value: 10 } },
    });
}

function autoTrackMenuAction(fullPath: string): MenuAction {
    if (isAutoTrackSource(fullPath)) {
        return {
            label:
                autoTrackBlock(fullPath) === null
                    ? "Auto-Track: ON"
                    : "Auto-Track: ON (paused)",
            icon: Icons.radar,
            onClick: () => {
                if (toggleAutoTrackSource(fullPath) === null) {
                    ChatLib.chat("&c[htsw] Couldn't save the Auto-Track setting.");
                }
            },
        };
    }
    const block = autoTrackBlock(fullPath);
    if (block !== null) {
        return {
            label:
                block === "unbound"
                    ? "Auto-Track: bind to a house first"
                    : "Auto-Track: enter the bound house first",
            icon: Icons.radar,
            disabled: true,
            onClick: () => {},
        };
    }
    return {
        label: "Auto-Track: OFF",
        icon: Icons.radar,
        onClick: () => {
            if (toggleAutoTrackSource(fullPath) === null) {
                ChatLib.chat("&c[htsw] Couldn't save the Auto-Track setting.");
                return;
            }
            autoTrackRefresh();
        },
    };
}

export function resultRow(
    r: Result,
    sourceKey: string,
    defaultExpanded: boolean,
    extraActions: MenuAction[] = [],
    labelOverride?: string
): Element {
    const isImport = r.type === "import";
    const parsePending = r.type === "import" && r.parse === null && r.parsePending;
    const importJsonPath = isImport ? r.fullPath : null;
    const expKey = expansionKey(sourceKey, r.fullPath);
    const expanded = isImport && isImportExpanded(expKey, defaultExpanded);
    const aggregateIndicators =
        isImport && !expanded ? collapsedSubtreeAggregates(r, includeTreeOf(r)) : [];
    const actions = (): MenuAction[] => {
        const filteredImportables = isImport
            ? filteredSubtreeImportables(r, includeTreeOf(r))
            : [];
        const exportCount = houseExportCount(filteredImportables);
        const fileExtras: MenuAction[] = isImport
            ? [
                  {
                      label: `Queue all for import (${filteredImportables.length})`,
                      icon: Icons.listPlus,
                      onClick: () => queueImportables(r, r.fullPath, filteredImportables),
                  },
                  ...queueModifiedAction(filteredImportables, () =>
                      queueModifiedSubtree(r, r.fullPath, filteredImportables)
                  ),
                  {
                      label: `Re-export from house (${exportCount})`,
                      icon: Icons.refreshCw,
                      disabled: () => getHousingUuid() === null,
                      onClick: () =>
                          confirmProjectReExport(r, r.fullPath, filteredImportables),
                  },
                  {
                      label: `Read from house (${deepReadableCount(filteredImportables)})`,
                      icon: Icons.scanEye,
                      disabled: () => getHousingUuid() === null,
                      onClick: () =>
                          runProjectDeepRead(r, r.fullPath, filteredImportables),
                  },
                  { kind: "separator" },
                  openInViewAction(r.fullPath, importJsonPath),
                  { kind: "separator" },
                  autoTrackMenuAction(r.fullPath),
                  acceptHouseLockMenuAction(r.fullPath),
                  {
                      label: "Open project in VSCode",
                      icon: Icons.folderCode,
                      onClick: () => {
                          openInVSCode(projectDirOf(r.fullPath), { newWindow: true });
                      },
                  },
                  ...fsActions(r.fullPath),
                  ...extraActions,
                  { kind: "separator" },
                  {
                      label: "Delete project folder…",
                      icon: Icons.trash2,
                      onClick: () => confirmDeleteProject(r.fullPath),
                  },
              ]
            : [openInViewAction(r.fullPath, importJsonPath), ...extraActions];
        return isImport
            ? fileExtras
            : composeFileMenu(fileExtras, r.fullPath, importJsonPath);
    };
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
        onClick: rowHandler(actions, () => previewSelect(r.fullPath, importJsonPath)),
        onDoubleClick: () => confirmSelect(r.fullPath, importJsonPath),
        children: [
            isImport
                ? caretButton(
                      expanded,
                      () => {
                          importExpansion.set(expKey, !expanded);
                          bumpTreeRevision();
                      },
                      DISCLOSURE_W
                  )
                : rowSlot(DISCLOSURE_W),
            fileIconFor(r),
            rowSlot(INNER_GAP),
            Text({
                text: labelOverride ?? r.path,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            ...aggregateIndicators,
            parsePendingIndicator(r),
            parsePending && rowSlot(INNER_GAP),
            isImport && autoTrackIndicator(r.fullPath),
            isImport && isAutoTrackSource(r.fullPath) && rowSlot(INNER_GAP),
            isImport && houseBindControl(r.fullPath),
            isImport && rowMenuButton(actions, `import-json:${r.fullPath}`),
        ],
    });
}

// Label for an include-group ROW: the included file relative to its IMMEDIATE
// parent import.json's directory ("clocks", "../shared/menus-module").
// Indentation already conveys nesting for downward includes; upward includes
// keep their "../" hops so the cross-folder relationship stays visible.
function includeRowLabel(
    parentNodePath: string,
    rootNodePath: string,
    fullPath: string
): string {
    const rel =
        relativePath(projectDirOf(parentNodePath), fullPath) ??
        relativePath(projectDirOf(rootNodePath), fullPath);
    if (rel === null) return shortPath(fullPath);
    const suffix = "/import.json";
    if (
        rel.length > suffix.length &&
        rel.lastIndexOf(suffix) === rel.length - suffix.length
    ) {
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
    return normalizePathSeparators(path)
        .split("/")
        .filter((part) => part.length > 0);
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
    const aggregateIndicators = expanded ? [] : collapsedSubtreeAggregates(parent, node);
    const actions = (): MenuAction[] => {
        const declaredImportables = filteredSubtreeImportables(parent, node);
        const count = houseExportCount(declaredImportables);
        return [
            {
                label: `Queue all for import (${declaredImportables.length})`,
                icon: Icons.listPlus,
                onClick: () => queueImportables(parent, fullPath, declaredImportables),
            },
            ...queueModifiedAction(declaredImportables, () =>
                queueModifiedSubtree(parent, fullPath, declaredImportables)
            ),
            {
                label: `Re-export from house (${count})`,
                icon: Icons.refreshCw,
                disabled: () => getHousingUuid() === null,
                onClick: () =>
                    confirmProjectReExport(parent, fullPath, declaredImportables),
            },
            {
                label: `Read from house (${deepReadableCount(declaredImportables)})`,
                icon: Icons.scanEye,
                disabled: () => getHousingUuid() === null,
                onClick: () => runProjectDeepRead(parent, fullPath, declaredImportables),
            },
            { kind: "separator" },
            openInViewAction(fullPath, parent.fullPath),
            { kind: "separator" },
            ...fsActions(fullPath),
            { kind: "separator" },
            {
                label: "Delete project folder…",
                icon: Icons.trash2,
                onClick: () =>
                    confirmDeleteIncludedProject(canonicalPath(parentNodePath), fullPath),
            },
        ];
    };
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
            caretButton(
                expanded,
                () => {
                    includeGroupExpansion.set(expKey, !expanded);
                    bumpTreeRevision();
                },
                DISCLOSURE_W
            ),
            Icon({ name: Icons.fileJson, color: ACCENT_INFO }),
            rowSlot(INNER_GAP),
            Text({
                text: includeRowLabel(
                    parentNodePath,
                    canonicalPath(parent.fullPath),
                    fullPath
                ),
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            ...aggregateIndicators,
            Text({
                text: String(subtreeImportableCount(node)),
                color: COLOR_TEXT_FAINT,
            }),
            rowMenuButton(actions, `include:${fullPath}`),
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
    const actions = (): MenuAction[] =>
        composeFileMenu(
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
        tooltip: "Also included here — click to jump to its contents",
        tooltipColor: COLOR_TEXT_FAINT,
        children: [
            rowSlot(DISCLOSURE_W),
            Icon({
                name: Icons.cornerUpLeft,
                color: COLOR_TEXT_FAINT,
            }),
            rowSlot(INNER_GAP),
            Text({
                text: includeRowLabel(
                    parentNodePath,
                    canonicalPath(parent.fullPath),
                    fullPath
                ),
                color: COLOR_TEXT_FAINT,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            home !== null &&
                Text({
                    text: String(subtreeImportableCount(home)),
                    color: COLOR_TEXT_FAINT,
                }),
            rowMenuButton(actions, `include-reference:${fullPath}:${parentNodePath}`),
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
                style: {
                    width: { kind: "px", value: 9 },
                    height: { kind: "px", value: 9 },
                },
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
 * Toggle an importable's queue membership from a Projects row. Adding (an
 * unchecked importable → checked) is always allowed, even mid-import — the
 * queue session tracks late adds as "pending" and they survive the run.
 * Removing (checked → unchecked) is blocked while an import is running: the
 * queue is locked so a live run's items can't be yanked out from under it.
 */
function toggleImportableInQueue(
    parent: ResultImport,
    imp: Importable,
    checked: boolean
): void {
    if (checked && isTaskRunning()) return; // would remove — locked mid-run
    const item = projectImportQueueRow(parent, imp);
    if (checked) removeFromQueue(item);
    else {
        const result = addToQueue(item);
        if (result.kind === "added" || result.kind === "alsoQueuedOtherDirection") {
            autoRunQueueChanged();
        }
    }
}

export function importableRow(parent: ResultImport, imp: Importable): Element {
    const previewPath = importablePreviewPath(parent, imp);
    const expandable = isImportableExpandable(imp);
    const expKey = importableExpansionKey(parent.fullPath, imp);
    const expanded = importableExpansion.has(expKey);
    const queueItem = projectImportQueueRow(parent, imp);
    const checked = (): boolean => isQueueItemQueued(queueItem);
    const diagCounts = diagnosticCountsFor(parent.parse, imp);
    const showBadge = diagCounts.errors > 0 || diagCounts.warnings > 0;
    const contentIcon = ImportableIcon({
        type: imp.type,
        name: importableLabel(imp),
        importable: imp,
    });
    const status = importableStatus(imp);
    const actions = (): MenuAction[] => importableActions(parent, imp);
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
            background: () => (isJumpFlashing(expKey) ? ROW_HOVER_BG : ROW_BG),
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(actions, () => previewSelect(previewPath, parent.fullPath)),
        onDoubleClick: () => confirmSelect(previewPath, parent.fullPath),
        children: [
            queueCheckbox(checked, (isChecked) =>
                toggleImportableInQueue(parent, imp, isChecked)
            ),
            typeMarker(IMPORTABLE_TYPE_COLORS[imp.type]),
            rowSlot(INNER_GAP),
            status,
            status !== false && rowSlot(INNER_GAP),
            contentIcon,
            contentIcon !== false && rowSlot(INNER_GAP),
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
            rowMenuButton(actions, `importable:${expKey}`),
        ],
    });
}

export function childListRow(
    parent: ResultImport,
    imp: Importable,
    kind: ImportableChildListName
): Element {
    const label = CHILD_LIST_LABELS[kind];
    const target = importableChildListPath(imp, kind) ?? parent.fullPath;
    const actions = composeFileMenu(
        [openInViewAction(target, parent.fullPath)],
        target,
        parent.fullPath
    );
    const cached = getCachedImportable(imp);
    const itemChange =
        imp.type === "ITEM" && cached?.type === "ITEM" ? itemChanges(imp, cached) : null;
    const changed =
        itemChange !== null &&
        ((kind === "leftClickActions" && itemChange.leftClickActions) ||
            (kind === "rightClickActions" && itemChange.rightClickActions));
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
            changed
                ? Text({
                      text: DIFF_SYMBOL.changed,
                      color: DIFF_COLOR.changed,
                      tooltip:
                          kind === "leftClickActions"
                              ? "Left click actions differ from the cached house item"
                              : "Right click actions differ from the cached house item",
                      tooltipColor: DIFF_COLOR.changed,
                      style: { width: { kind: "px", value: 8 } },
                  })
                : Text({ text: "", style: { width: { kind: "px", value: 8 } } }),
            Icon({
                name: Icons.fileCode,
                color: IMPORTABLE_TYPE_COLORS[imp.type],
                style: {
                    width: { kind: "px", value: 11 },
                    height: { kind: "px", value: 11 },
                },
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

export function menuSlotExpansionKey(
    parent: ResultImport,
    imp: Importable,
    slot: MenuSlot
): string {
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
    return parent.parse !== null
        ? importableDeclaringPath(imp, parent.parse)
        : parent.fullPath;
}

function slotItemId(slot: MenuSlot): string | undefined {
    const id = tagChild(slot.nbt, "id");
    return id !== undefined && id.type === "string" ? String(id.value) : undefined;
}

function slotItemLabel(slot: MenuSlot): string {
    const name = tagChild(tagChild(tagChild(slot.nbt, "tag"), "display"), "Name");
    if (
        name !== undefined &&
        name.type === "string" &&
        String(name.value).trim().length > 0
    ) {
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

export function menuSlotRow(
    parent: ResultImport,
    imp: Importable,
    slot: MenuSlot
): Element {
    const expKey = menuSlotExpansionKey(parent, imp, slot);
    const expanded = importableExpansion.has(expKey);
    const target = menuSlotFilePath(
        parent,
        imp,
        slot,
        slot.actions !== undefined ? "actions" : "item"
    );
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
                      style: {
                          width: { kind: "px", value: 11 },
                          height: { kind: "px", value: 11 },
                      },
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
                style: {
                    width: { kind: "px", value: 11 },
                    height: { kind: "px", value: 11 },
                },
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

const DIFF_SYMBOL: { [k in FieldDiff]: string } = {
    changed: "~",
    added: "+",
    removed: "-",
};
const DIFF_COLOR: { [k in FieldDiff]: number } = {
    changed: 0xffe5bc4b | 0,
    added: 0xff5cb85c | 0,
    removed: 0xffe85c5c | 0,
};

export function metadataRow(
    parent: ResultImport,
    imp: Importable,
    field: MetadataField
): Element {
    const fileTarget =
        imp.type === "ITEM" && field.key === "nbt"
            ? importableSourceFilePath(parent, imp)
            : null;
    const editable =
        field.key !== "legacyDiff" && !(imp.type === "NPC" && field.key === "pos");
    const actions =
        fileTarget === null
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
            fileTarget === null
                ? undefined
                : () => confirmSelect(fileTarget, parent.fullPath),
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
    return [{ label: "Close", icon: Icons.x, onClick: () => removeSource(s.fullPath) }];
}
