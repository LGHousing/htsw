/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";
import type { Element } from "../../lib/layout";
import { Col, Input, Scroll, Text } from "../../lib/components";
import { closeAllPopovers, openPopover } from "../../lib/popovers";
import { ACCENT_WARN } from "../../lib/theme";
import { shortPath } from "../../lib/pathDisplay";
import {
    canonicalPath,
    invalidateParseCacheEntry,
    requestParse,
} from "../../parsing/parses";
import { importableDeclaringPath } from "../../parsing/importablePaths";
import { importableIdentity } from "../../../importables/identity";
import { moveImportableEntry, type Section } from "../../../project/importJsonMutations";
import { createIncludedFolderInTree } from "../../../project/paths";
import { openTextPromptPopover } from "../../popovers/text-prompt";
import { closeTab } from "../../right-panel/selection";
import {
    PICKER_ROW_H,
    buildPickerNode,
    countVisiblePickerRows,
    newPickerRow,
    pickerMenuWidth,
    pickerTreeRows,
    type PickerNode,
} from "../../popovers/includeTreePicker";
import { SECTION_BY_TYPE, bumpTreeRevision, type ResultImport } from "./rowModel";
import { includeTreeOf } from "./includeTree";

// The "Move to…" destination picker renders the include tree as a collapsible
// folder tree (caret expands, clicking the row moves) via the shared
// includeTreePicker. State is rebuilt fresh on each open.
const MOVE_ROW_H = PICKER_ROW_H;
const MOVE_SEARCH_THRESHOLD = 8;

let moveTreeRoots: PickerNode[] = [];
const moveExpansion: Set<string> = new Set();
let moveFilter = "";
let moveShowSearch = false;
let moveCtx: { entryPath: string; section: Section; identity: string } | null = null;

function dirOfPath(p: string): string {
    const s = p.split("\\").join("/");
    const i = s.lastIndexOf("/");
    return i < 0 ? s : s.substring(0, i);
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

// Pinned below the tree: create `<folder>/import.json` (included from the
// deepest containing file, so "functions/combat" hangs off functions/) and
// move the importable there in one step.
function newFolderRow(): Element {
    return newPickerRow("New folder…", () => {
        openTextPromptPopover({
            title: "Move to new folder",
            placeholder: "functions/combat",
            submitLabel: "Create & move",
            onSubmit: (folderPath) => {
                const ctx = moveCtx;
                if (ctx === null) return;
                try {
                    const created = createIncludedFolderInTree(ctx.entryPath, folderPath);
                    performMoveTo(created.importJsonPath);
                } catch (err) {
                    ChatLib.chat(`&c[htsw] New folder failed: ${String(err)}`);
                }
            },
        });
    });
}

function moveTreeRows(): Element[] {
    return pickerTreeRows(moveTreeRoots, {
        expansion: moveExpansion,
        filter: moveFilter,
        selectedPath: null,
        disabledLabel: "here",
        onSelect: performMoveTo,
        onToggle: (path) => {
            if (moveExpansion.has(path)) moveExpansion.delete(path);
            else moveExpansion.add(path);
        },
        emptyLabel: "No other import.json yet",
    });
}

export function openMoveDestinationPicker(
    parent: ResultImport,
    imp: Importable,
    anchorX: number,
    anchorY: number
): void {
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
            moveTreeRoots.push(buildPickerNode(root.includes[i], projectDir, 0, current));
        }
        total = 0;
        for (let i = 0; i < moveTreeRoots.length; i++)
            total += moveTreeRoots[i].selectableCount;
    } else {
        const rootNode = buildPickerNode(root, projectDir, 0, current);
        moveTreeRoots = [rootNode];
        total = rootNode.selectableCount;
    }
    const section = SECTION_BY_TYPE[imp.type];
    if (section === undefined) {
        ChatLib.chat("&7[htsw] This importable type can't be moved.");
        return;
    }

    // Zero existing destinations still opens the picker — "New folder…"
    // below is how a flat project grows its first include.

    // Expand the top-level folders so the picker opens showing real
    // destinations rather than a near-empty box; deeper levels stay collapsed.
    for (let i = 0; i < moveTreeRoots.length; i++) {
        if (moveTreeRoots[i].children.length > 0)
            moveExpansion.add(moveTreeRoots[i].path);
    }

    moveFilter = "";
    moveShowSearch = total > MOVE_SEARCH_THRESHOLD;
    const ctx = {
        entryPath: parent.fullPath,
        section,
        identity: importableIdentity(imp),
    };
    moveCtx = ctx;

    const visibleCount = countVisiblePickerRows(moveTreeRoots, moveExpansion);
    const visibleRows = visibleCount < 2 ? 2 : visibleCount > 12 ? 12 : visibleCount;
    const scrollH = visibleRows * MOVE_ROW_H + 4;
    const height = 8 + 10 + (moveShowSearch ? 12 + 22 : 6) + scrollH + 6 + MOVE_ROW_H + 8;

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
    contentChildren.push(newFolderRow());
    const content = Col({
        style: { padding: 8, gap: 6, height: { kind: "grow" } },
        children: contentChildren,
    });

    const titleW = Renderer.getStringWidth(`Move '${ctx.identity}' to…`) + 20;
    const width = Math.min(340, Math.max(pickerMenuWidth(moveTreeRoots), titleW));

    openPopover({
        anchor: { x: anchorX, y: anchorY, w: 0, h: 0 },
        excludeAnchor: false,
        content,
        width,
        height,
        key: "move-to",
    });
}
