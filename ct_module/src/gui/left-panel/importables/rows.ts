/// <reference types="../../../../CTAutocomplete" />

import {
    ClickInfo,
    Element,
    Rect,
} from "../../lib/layout";
import { Container, Icon, McItem, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import { openMenu, MenuAction } from "../../lib/menu";
import { openRenameImportablePopover } from "../../popovers/rename-importable";
import { openConfirmPopover } from "../../popovers/confirm";
import {
    getHousingUuid,
    isAutoTrackSource,
    isImportableChecked,
    setExportImportJsonPath,
    toggleAutoTrackSource,
    toggleImportableChecked,
} from "../../state";
import { ACCENT_DANGER, ACCENT_SUCCESS, ACCENT_WARN, COLOR_TEXT_DIM, COLOR_TEXT_FAINT, GLYPH_DOT } from "../../lib/theme";
import { diagnosticCountsFor, type SeverityCounts } from "../../cache-status/diagnosticCounts";
import { openEditFunctionFieldPopover } from "../../popovers/edit-function";
import { STATUS_COLOR, STATUS_LABEL, cacheStateForImportable } from "../../cache-status";
import {
    hasSubList,
    importableSourcePath,
    importableSubListPath,
    type SubListKind,
} from "../../parsing/importablePaths";
import { importableIdentity, importableKey } from "../../../importCache/paths";
import { houseDisplayName } from "../../../importCache/aliases";
import {
    removeImportableEntry,
    setHouseUuidKey,
    type Section,
} from "../../../exporter/importJsonWriter";
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
import { readImportableCache } from "../../../importCache/cache";
import { canonicalIconItem } from "../../../importCache/hash";
import { addToQueue, makeImportableQueueItem, queueItemKey, removeFromQueueKey } from "../../right-panel/import-tab/queue";
import { isImportRunning } from "../../../housingSync/runtimeState";
import { composeFileMenu, composeImportableMenu } from "../../menus/fileMenu";
import { autoTrackRefresh, queueModifiedFromParse } from "../../right-panel/import-tab/importController";
import { SourceDir, SourceFile, removeSource } from "./source";
import { type IncludeNode, subtreeImportableCount } from "./includeTree";
import { showInExplorer, openInVSCode } from "../../../utils/osShell";
import {
    closeTab,
    closeTabsUnder,
    confirmSelect,
    previewSelect,
    setActiveRightTab,
} from "../../right-panel/selection";
import {
    Result,
    ResultImport,
    IMPORTABLE_TYPE_COLORS,
    ROW_BG,
    ROW_HOVER_BG,
    bumpTreeRevision,
} from "./rowModel";
import type { Bounds, Importable } from "htsw/types";

export let searchQuery = "";
export function setSearchQuery(v: string): void {
    searchQuery = v;
    bumpTreeRevision();
}

export const importExpansion: Map<string, boolean> = new Map();
export function expansionKey(sourceKey: string, fullPath: string): string {
    return `${sourceKey}::${fullPath}`;
}
// Paths that should start expanded regardless of the sole-import default —
// e.g. the freshly created starter project. An explicit user toggle wins.
const autoExpandPaths = new Set<string>();
export function requestImportAutoExpand(fullPath: string): void {
    autoExpandPaths.add(fullPath);
}
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
export const includeGroupExpansion: Map<string, boolean> = new Map();
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

export type FieldDiff = "changed" | "added" | "removed";
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
        { kind: "separator" },
        {
            label: "Delete from project…",
            icon: Icons.trash2,
            onClick: () => confirmDeleteImportable(parent, imp),
        },
    ];
    return composeImportableMenu(extras, target, item);
}

function rowHandler(
    actions: MenuAction[],
    defaultLeftAction?: () => void
): (rect: Rect, info: ClickInfo) => void {
    return (_rect, info) => {
        if (info.isDoubleClickSecond) return;
        if (info.button === 1) {
            openMenu(info.x, info.y, actions);
            return;
        }
        if (info.button !== 0) return;
        if (defaultLeftAction) defaultLeftAction();
        else openMenu(info.x, info.y, actions);
    };
}

export const ROOT_DIR_PREFIX = "dir:";

export function dirRootKey(s: SourceDir): string {
    return ROOT_DIR_PREFIX + s.fullPath;
}

export function rootRow(label: string, key: string, actions: MenuAction[]): Element {
    const collapsed = collapsedRoots.has(key);
    return Container({
        style: {
            direction: "row",
            padding: [
                { side: "left", value: 3 },
                { side: "right", value: 6 },
            ],
            gap: 6,
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
                { side: "left", value: 3 },
                { side: "right", value: 6 },
            ],
            gap: 6,
            align: "center",
            height: { kind: "px", value: 18 },
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(actions, () => {
            if (isImport) {
                importExpansion.set(expKey, !expanded);
                bumpTreeRevision();
            }
        }),
        onDoubleClick: () => {
            if (isImport) {
                // The first click of the double toggled expansion; a double-click
                // means "open", not "expand" — toggle it back (same undo pattern
                // as the checkbox rows).
                importExpansion.set(expKey, !isImportExpanded(expKey, defaultExpanded));
                bumpTreeRevision();
            }
            previewSelect(r.fullPath);
            setActiveRightTab("view");
        },
        children: [
            Text({
                text: labelOverride ?? r.path,
                style: { width: { kind: "grow" } },
            }),
            isImport && houseBindControl(r.fullPath),
            isImport &&
                Icon({
                    name: expanded ? Icons.chevronDown : Icons.chevronRight,
                }),
        ],
    });
}

function includeGroupLabel(parent: ResultImport, fullPath: string): string {
    const dir = projectDirOf(parent.fullPath);
    if (fullPath.indexOf(dir + "/") === 0) return fullPath.substring(dir.length + 1);
    return shortPath(fullPath);
}

export function includeGroupRow(
    parent: ResultImport,
    node: IncludeNode,
    expKey: string,
    defaultExpanded: boolean
): Element {
    const fullPath = canonicalPath(node.path);
    const expanded = isIncludeGroupExpanded(expKey, defaultExpanded);
    const actions = composeFileMenu([openInViewAction(fullPath)], fullPath);
    return Container({
        style: {
            direction: "row",
            padding: [
                { side: "left", value: 3 },
                { side: "right", value: 6 },
            ],
            gap: 6,
            align: "center",
            height: { kind: "px", value: 18 },
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(actions, () => {
            includeGroupExpansion.set(expKey, !expanded);
            bumpTreeRevision();
        }),
        onDoubleClick: () => {
            // First click of the double toggled — undo it; double means
            // "open", same pattern as the import.json header rows.
            includeGroupExpansion.set(expKey, !isIncludeGroupExpanded(expKey, defaultExpanded));
            bumpTreeRevision();
            previewSelect(fullPath);
            setActiveRightTab("view");
        },
        children: [
            Icon({ name: expanded ? Icons.chevronDown : Icons.chevronRight }),
            Text({
                text: includeGroupLabel(parent, fullPath),
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
    const cacheState = cacheStateForImportable(imp);
    const dotColor = cacheState === null ? COLOR_TEXT_FAINT : STATUS_COLOR[cacheState];
    const dotLabel = cacheState === null ? "loading…" : STATUS_LABEL[cacheState];
    const expandable = isImportableExpandable(imp);
    const expKey = importableExpansionKey(parent.fullPath, imp);
    const expanded = importableExpansion.has(expKey);
    const checkKey = importableKey(imp.type, importableIdentity(imp));
    const checked = isImportableChecked(checkKey);
    const diagCounts = diagnosticCountsFor(parent.parse, imp);
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
        onClick: rowHandler(importableActions(parent, imp), () => {
            toggleImportableInQueue(parent, imp, checkKey, checked);
        }),
        onDoubleClick: () => {
            toggleImportableInQueue(parent, imp, checkKey, checked);
            previewSelect(previewPath);
            setActiveRightTab("view");
        },
        children: [
            Text({
                text: checked ? "[x]" : "[ ]",
                color: checked ? ACCENT_SUCCESS : COLOR_TEXT_DIM,
                style: { width: { kind: "px", value: 14 } },
            }),
            Container({
                style: {
                    width: { kind: "px", value: 6 },
                    height: { kind: "px", value: 12 },
                    background: IMPORTABLE_TYPE_COLORS[imp.type],
                },
                children: [],
            }),
            Text({
                text: GLYPH_DOT,
                color: dotColor,
                tooltip: dotLabel,
                tooltipColor: dotColor,
                style: { width: { kind: "px", value: 6 } },
            }),
            imp.type === "FUNCTION" && imp.icon !== undefined &&
                McItem({ item: imp.icon.item, count: imp.icon.count ?? 1 }),
            Text({
                text: importableLabel(imp),
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
            (diagCounts.errors > 0 || diagCounts.warnings > 0) &&
                diagnosticBadge(diagCounts),
            Text({ text: imp.type, color: 0xff8a92a3 | 0 }),
            expandable &&
                Container({
                    style: {
                        width: { kind: "px", value: 14 },
                        height: { kind: "grow" },
                        align: "center",
                    },
                    onClick: (_rect, info) => {
                        if (info.isDoubleClickSecond) return;
                        if (info.button !== 0) return;
                        if (expanded) importableExpansion.delete(expKey);
                        else importableExpansion.add(expKey);
                        bumpTreeRevision();
                    },
                    children: [
                        Icon({
                            name: expanded ? Icons.chevronDown : Icons.chevronRight,
                        }),
                    ],
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
            gap: 6,
            align: "center",
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: rowHandler(actions, () => {
            /* preview is on double-click, matching every other row */
        }),
        onDoubleClick: () => {
            previewSelect(target);
            setActiveRightTab("view");
        },
        children: [
            Text({
                text: label,
                color: 0xff8a92a3 | 0,
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
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

export function standaloneCloseAction(s: SourceFile): MenuAction[] {
    return [{ label: "Close", onClick: () => removeSource(s.fullPath) }];
}
