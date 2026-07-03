/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";
import type { Element } from "../../lib/layout";
import { Col, Container, Icon, Input, Scroll, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import { closeAllPopovers, openPopover } from "../../lib/popovers";
import {
    ACCENT_INFO,
    ACCENT_WARN,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
} from "../../lib/theme";
import { shortPath } from "../../lib/pathDisplay";
import {
    canonicalPath,
    invalidateParseCacheEntry,
    requestParse,
} from "../../parsing/parses";
import { importableDeclaringPath } from "../../parsing/importablePaths";
import { importableIdentity } from "../../../importables/identity";
import {
    moveImportableEntry,
    type Section,
} from "../../../project/importJsonMutations";
import { closeTab } from "../../right-panel/selection";
import {
    ROW_BG,
    ROW_HOVER_BG,
    SECTION_BY_TYPE,
    bumpTreeRevision,
    caretButton,
    type ResultImport,
} from "./rowModel";
import { type IncludeNode, includeTreeOf } from "./includeTree";

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

    const section = SECTION_BY_TYPE[imp.type];
    if (section === undefined) {
        ChatLib.chat("&7[htsw] This importable type can't be moved.");
        return;
    }

    moveFilter = "";
    moveShowSearch = total > MOVE_SEARCH_THRESHOLD;
    const ctx = {
        entryPath: parent.fullPath,
        section,
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
        anchor: { x: anchorX, y: anchorY, w: 0, h: 0 },
        excludeAnchor: false,
        content,
        width,
        height,
        key: "move-to",
    });
}
