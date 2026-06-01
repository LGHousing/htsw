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
import {
    getKnowledgeRows,
    isAutoTrackSource,
    isImportableChecked,
    toggleAutoTrackSource,
    toggleImportableChecked,
} from "../../state";
import { ACCENT_SUCCESS, COLOR_TEXT_DIM, COLOR_TEXT_FAINT, GLYPH_DOT } from "../../lib/theme";
import { openEditFunctionFieldPopover } from "../../popovers/edit-function";
import { STATUS_COLOR, STATUS_LABEL, statusForImportable } from "../../knowledge-status";
import {
    allReferencedPaths,
    hasSubList,
    importableSourcePath,
    importableSubListPath,
    type SubListKind,
} from "../../state/importablePaths";
import { importableIdentity, importableKey } from "../../../importCache/paths";
import { addToQueue, makeImportableQueueItem, queueItemKey, removeFromQueueKey } from "../../state/queue";
import { composeFileMenu, composeImportableMenu } from "../../state/fileMenu";
import { autoTrackRefresh, queueModifiedFromParse } from "../../right-panel/import-tab/actions";
import { SourceDir, SourceFile, removeSource } from "./source";
import { showInExplorer, openInVSCode } from "../../../utils/osShell";
import { previewSelect, confirmSelect } from "../../state/selection";
import {
    Result,
    ResultImport,
    TYPE_COLORS,
    IMPORTABLE_TYPE_COLORS,
    ROW_BG,
    ROW_HOVER_BG,
} from "./types";
import type { Importable } from "htsw/types";

export let searchQuery = "";
export function setSearchQuery(v: string): void {
    searchQuery = v;
}

export const importExpansion: Map<string, boolean> = new Map();
export function expansionKey(sourceKey: string, fullPath: string): string {
    return `${sourceKey}::${fullPath}`;
}
export function isImportExpanded(expKey: string, defaultExpanded: boolean): boolean {
    const explicit = importExpansion.get(expKey);
    if (explicit !== undefined) return explicit;
    return defaultExpanded;
}
export const collapsedRoots: Set<string> = new Set();

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
    const rows = getKnowledgeRows();
    const id = importableIdentity(imp);
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].identity === id && rows[i].importable.type === imp.type && rows[i].entry !== null) {
            return rows[i].entry!.importable;
        }
    }
    return null;
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
                diff: cf !== null ? valDiff(imp.icon?.item, cf.icon?.item) : undefined,
            },
        ];
        if (imp.icon !== undefined) {
            fields.push({
                key: "iconCount",
                label: "Count",
                value: imp.icon.count !== undefined ? String(imp.icon.count) : "1",
                diff: cf !== null ? valDiff(imp.icon.count, cf?.icon?.count) : undefined,
            });
        }
        return fields;
    }
    if (imp.type === "REGION") {
        const cr = cached !== null && cached.type === "REGION" ? cached : null;
        return [
            {
                key: "boundsFrom", label: "From", value: formatPos(imp.bounds.from),
                diff: cr !== null ? valDiff(imp.bounds.from, cr.bounds.from) : undefined,
            },
            {
                key: "boundsTo", label: "To", value: formatPos(imp.bounds.to),
                diff: cr !== null ? valDiff(imp.bounds.to, cr.bounds.to) : undefined,
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
            },
        },
    ];
    return withFsActions(extras, s.fullPath);
}

function importableActions(parent: ResultImport, imp: Importable): MenuAction[] {
    const target = importablePreviewPath(parent, imp);
    const item = makeImportableQueueItem(imp, parent.fullPath);
    const extras: MenuAction[] = [
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
        }),
        children: [
            Icon({ name: collapsed ? Icons.chevronRight : Icons.chevronDown }),
            Text({ text: label, style: { width: { kind: "grow" } } }),
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
                  label: "Open in VSCode (with references)",
                  onClick: () => {
                      const paths = allReferencedPaths(r.fullPath, r.parse);
                      openInVSCode(paths);
                  },
              },
              ...extraActions,
          ]
        : extraActions;
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
            }
            previewSelect(r.fullPath);
        }),
        onDoubleClick: () => confirmSelect(r.fullPath),
        children: [
            Container({
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                    background: TYPE_COLORS[r.type],
                },
                children: [],
            }),
            Text({
                text: labelOverride ?? r.path,
                style: { width: { kind: "grow" } },
            }),
            isImport &&
                Icon({
                    name: expanded ? Icons.chevronDown : Icons.chevronRight,
                }),
        ],
    });
}

export function importableRow(parent: ResultImport, imp: Importable): Element {
    const previewPath = importablePreviewPath(parent, imp);
    const status = statusForImportable(imp);
    const expandable = isImportableExpandable(imp);
    const expKey = importableExpansionKey(parent.fullPath, imp);
    const expanded = importableExpansion.has(expKey);
    const checkKey = importableKey(imp.type, importableIdentity(imp));
    const checked = isImportableChecked(checkKey);
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
            const nowChecked = toggleImportableChecked(checkKey);
            const item = makeImportableQueueItem(imp, parent.fullPath);
            if (nowChecked) addToQueue(item);
            else removeFromQueueKey(queueItemKey(item));
        }),
        onDoubleClick: () => {
            const reverted = toggleImportableChecked(checkKey);
            const item = makeImportableQueueItem(imp, parent.fullPath);
            if (reverted) addToQueue(item);
            else removeFromQueueKey(queueItemKey(item));
            confirmSelect(previewPath);
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
                color: STATUS_COLOR[status],
                tooltip: STATUS_LABEL[status],
                tooltipColor: STATUS_COLOR[status],
                style: { width: { kind: "px", value: 6 } },
            }),
            imp.type === "FUNCTION" && imp.icon !== undefined &&
                McItem({ item: imp.icon.item, count: imp.icon.count ?? 1 }),
            Text({
                text: importableLabel(imp),
                style: { width: { kind: "grow" } },
            }),
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
    const actions = composeFileMenu([], target);
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
        onClick: rowHandler(actions, () => previewSelect(target)),
        onDoubleClick: () => confirmSelect(target),
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
