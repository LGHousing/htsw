/// <reference types="../../../CTAutocomplete" />

import type { Element } from "../lib/layout";
import { Container, Icon, Text } from "../lib/components";
import { Icons } from "../lib/icons.generated";
import {
    ACCENT_INFO,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
} from "../lib/theme";
import { canonicalPath } from "../parsing/parses";
import { ROW_BG, ROW_HOVER_BG, caretButton } from "../left-panel/projects/rowModel";
import type { IncludeNode } from "../left-panel/projects/includeTree";

// The selectable include-tree UI shared by the "Move to…" destination picker
// and the export sub-target picker: a collapsible folder tree of a project's
// include structure, each import.json a selectable row, with a pinned
// "New …" action. Both callers own their own expansion/filter state and open
// their own popover; only the model + row rendering live here.

const PICKER_INDENT = 12;
const PICKER_CARET_W = 18;
export const PICKER_ROW_H = 18;

export type PickerNode = {
    /** Canonical (forward-slash) path of this node's import.json. */
    path: string;
    label: string;
    depth: number;
    /** Rendered dim with no click (e.g. the importable's own current file). */
    disabled: boolean;
    children: PickerNode[];
    /** Selectable destinations in this subtree (excludes disabled nodes). */
    selectableCount: number;
};

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

// A destination's label is its path relative to its parent node's directory
// with a trailing import.json dropped, so a sub-include reads as "clocks"
// instead of "functions/clocks/import.json".
function includeNodeLabel(parentDir: string, nodePath: string): string {
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

export function buildPickerNode(
    node: IncludeNode,
    parentDir: string,
    depth: number,
    disabledPath: string | null
): PickerNode {
    const path = canonicalPath(node.path);
    const dir = dirOfPath(path);
    const children: PickerNode[] = [];
    for (let i = 0; i < node.includes.length; i++) {
        children.push(buildPickerNode(node.includes[i], dir, depth + 1, disabledPath));
    }
    const disabled = disabledPath !== null && path === disabledPath;
    let selectableCount = disabled ? 0 : 1;
    for (let i = 0; i < children.length; i++) selectableCount += children[i].selectableCount;
    return {
        path,
        label: includeNodeLabel(parentDir, path),
        depth,
        disabled,
        children,
        selectableCount,
    };
}

// Rows visible under the current expansion (no filter) — used to size the
// popover so the default-expanded top level fills it without dead space.
export function countVisiblePickerRows(nodes: PickerNode[], expansion: Set<string>): number {
    let n = 0;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        n += 1;
        if (node.children.length > 0 && expansion.has(node.path)) {
            n += countVisiblePickerRows(node.children, expansion);
        }
    }
    return n;
}

function subtreeMatches(n: PickerNode, q: string): boolean {
    if (n.label.toLowerCase().indexOf(q) >= 0) return true;
    for (let i = 0; i < n.children.length; i++) {
        if (subtreeMatches(n.children[i], q)) return true;
    }
    return false;
}

export type PickerRenderOptions = {
    expansion: Set<string>;
    filter: string;
    /** Canonical path of the currently-selected destination (gets a check). */
    selectedPath: string | null;
    /** Trailing label on a disabled node (e.g. "here"); "" hides it. */
    disabledLabel: string;
    onSelect: (path: string) => void;
    onToggle: (path: string) => void;
    emptyLabel: string;
};

function pickerRowElement(
    n: PickerNode,
    expanded: boolean,
    opts: PickerRenderOptions
): Element {
    const hasChildren = n.children.length > 0;
    const selected = opts.selectedPath !== null && n.path === opts.selectedPath;
    const children: Element[] = [];
    if (n.depth > 0) {
        children.push(
            Container({
                style: { width: { kind: "px", value: n.depth * PICKER_INDENT } },
                children: [],
            })
        );
    }
    if (hasChildren) {
        children.push(
            caretButton(expanded, () => opts.onToggle(n.path), PICKER_CARET_W)
        );
    } else {
        children.push(
            Container({
                style: { width: { kind: "px", value: PICKER_CARET_W } },
                children: [],
            })
        );
    }
    // Every destination is an import.json — the same blue { } the main tree
    // uses. The selected one swaps in a check; expandable ones are told apart
    // by the caret, not a folder icon.
    children.push(
        Icon({ name: selected ? Icons.check : Icons.fileJson, color: selected ? undefined : ACCENT_INFO })
    );
    children.push(
        Container({ style: { width: { kind: "px", value: 6 } }, children: [] })
    );
    children.push(
        Text({
            text: n.label,
            color: n.disabled ? COLOR_TEXT_DIM : COLOR_TEXT,
            truncate: true,
            style: { width: { kind: "grow" } },
        })
    );
    if (n.disabled && opts.disabledLabel.length > 0) {
        children.push(Text({ text: opts.disabledLabel, color: COLOR_TEXT_FAINT }));
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
            height: { kind: "px", value: PICKER_ROW_H },
            background: ROW_BG,
            hoverBackground: n.disabled ? ROW_BG : ROW_HOVER_BG,
        },
        onClick: n.disabled
            ? undefined
            : (_rect, info) => {
                  if (info.isDoubleClickSecond) return;
                  if (info.button !== 0) return;
                  opts.onSelect(n.path);
              },
        children,
    });
}

export function pickerTreeRows(roots: PickerNode[], opts: PickerRenderOptions): Element[] {
    const q = opts.filter.trim().toLowerCase();
    const filtering = q.length > 0;
    const out: Element[] = [];
    const emit = (n: PickerNode): void => {
        if (filtering && !subtreeMatches(n, q)) return;
        const hasChildren = n.children.length > 0;
        const expanded = filtering ? true : opts.expansion.has(n.path);
        out.push(pickerRowElement(n, expanded, opts));
        if (hasChildren && expanded) {
            for (let i = 0; i < n.children.length; i++) emit(n.children[i]);
        }
    };
    for (let i = 0; i < roots.length; i++) emit(roots[i]);
    if (out.length === 0) {
        out.push(
            Container({
                style: { padding: 8 },
                children: [
                    Text({
                        text: filtering ? "No matches" : opts.emptyLabel,
                        color: COLOR_TEXT_DIM,
                    }),
                ],
            })
        );
    }
    return out;
}

export function pickerMenuWidth(nodes: PickerNode[]): number {
    let maxW = 150;
    const visit = (n: PickerNode): void => {
        const chrome = 4 + n.depth * PICKER_INDENT + PICKER_CARET_W + 16 + 6 + 24 + 6;
        const w = chrome + Renderer.getStringWidth(n.label);
        if (w > maxW) maxW = w;
        for (let i = 0; i < n.children.length; i++) visit(n.children[i]);
    };
    for (let i = 0; i < nodes.length; i++) visit(nodes[i]);
    return maxW > 340 ? 340 : maxW;
}

export function newPickerRow(label: string, onClick: () => void): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            gap: 6,
            padding: { side: "left", value: 4 },
            height: { kind: "px", value: PICKER_ROW_H },
            background: ROW_BG,
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: (_rect, info) => {
            if (info.isDoubleClickSecond) return;
            if (info.button !== 0) return;
            onClick();
        },
        children: [
            Icon({ name: Icons.folderPlus, color: COLOR_TEXT_DIM }),
            Text({ text: label, color: COLOR_TEXT, style: { width: { kind: "grow" } } }),
        ],
    });
}
