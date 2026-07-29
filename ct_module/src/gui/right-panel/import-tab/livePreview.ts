/// <reference types="../../../../CTAutocomplete" />

import * as htsw from "htsw";
import type { Action, Importable } from "htsw/types";
import { normalizeSoundKey } from "../../../housingSync/fields/sounds";
import type { TokenSpan, FieldSpan } from "../../code-view/lineTypes";
import type { DiffState } from "../../code-view/diffPalette";
import type {
    DiffFinalState,
    DiffOpKind,
    DiffSummary,
    PlannedOp,
} from "../../../housingSync/syncEvents";
import {
    ActionListPath,
    ActionPath,
    ActionTreePath,
    type ActionPathKey,
    type ChildActionListName,
} from "../../../housingSync/actionPath";
import { tokenizeHtsl } from "../syntax";
import { normalizeHtswPath } from "../../lib/pathDisplay";
import { markGuiDirty } from "../../lib/dirty";
import type {
    Observed,
    ObservedChildList,
    ObservedNode,
} from "../../../housingSync/observedActions";

type PreviewVariant = "body" | "else" | "close" | "ghost" | "placeholder";

export type PreviewLine = {
    id: string;
    variant: PreviewVariant;
    actionPath?: ActionTreePath;
    pending?: boolean;
    tokens: TokenSpan[];
    fieldSpans?: readonly FieldSpan[];
    depth: number;
    lineNum: number;
    italic?: boolean;
    diffState?: DiffState;
    completed?: boolean;
    deleted?: boolean;
};

type FileState = {
    lines: PreviewLine[];
    revision: number;
    hasContent: boolean;
    readCompletedPaths: Map<ActionPathKey, ActionPath>;
    /** Action path the importer is touching right now (cursor / scroll target). */
    currentPath: ActionTreePath | null;
    /** Set once the diff plan is known; its presence means we're in the apply phase. */
    summary: DiffSummary | null;
    lastObservedAt: number;
    pendingNodes: readonly ObservedNode[] | undefined;
    rebasedListKeys: Set<string>;
    evictionEligible: boolean;
};

/**
 * Minimum gap between full observed-snapshot rebuilds for one file. Each
 * rebuild reconstructs the whole line array (new line objects), which
 * invalidates the per-line text-wrap cache and forces a full re-measure on
 * the next frame. During the hydration of a large function the reader
 * emits snapshots in rapid bursts; coalescing them here keeps the rebuild
 * + re-measure cost bounded so the game stays responsive. The final state
 * is never lost: import finalization and export item completion force an
 * unthrottled terminal rebuild.
 */
const OBSERVED_REBUILD_THROTTLE_MS = 200;

const states = new Map<string, FileState>();
const MAX_PREVIEW_STATES = 128;

function keyForFile(path: string): string {
    return normalizeHtswPath(path);
}

function removeState(key: string): void {
    if (!states.delete(key)) return;
    markGuiDirty();
}

function evictCompletedPreview(): boolean {
    for (const [key, state] of states) {
        if (!state.evictionEligible) continue;
        removeState(key);
        return true;
    }
    return false;
}

function evictOldestPreview(): void {
    const oldest = states.keys().next();
    if (!oldest.done) removeState(oldest.value);
}

function ensure(path: string): FileState {
    const k = keyForFile(path);
    let s = states.get(k);
    if (!s) {
        while (states.size >= MAX_PREVIEW_STATES) {
            if (!evictCompletedPreview()) evictOldestPreview();
        }
        s = {
            lines: [],
            revision: 0,
            hasContent: false,
            readCompletedPaths: new Map(),
            currentPath: null,
            summary: null,
            lastObservedAt: 0,
            pendingNodes: undefined,
            rebasedListKeys: new Set(),
            evictionEligible: false,
        };
        states.set(k, s);
    } else {
        s.evictionEligible = false;
        states.delete(k);
        states.set(k, s);
    }
    return s;
}

function bump(s: FileState): void {
    s.revision = s.revision + 1;
    markGuiDirty();
}

const PENDING_PREFIX = "pending:";

function computeLineId(line: {
    actionPath?: ActionTreePath;
    variant: PreviewVariant;
    pending?: boolean;
}): string {
    const base = `${line.actionPath === undefined ? "?" : ActionTreePath.key(line.actionPath)}:${line.variant}`;
    return line.pending === true ? `${PENDING_PREFIX}${base}` : base;
}

function setPending(line: PreviewLine, pending: boolean): void {
    line.pending = pending;
    line.id = computeLineId(line);
}

function markLinesPending(lines: PreviewLine[]): void {
    for (let i = 0; i < lines.length; i++) setPending(lines[i], true);
}

function findActionStartIndex(
    lines: PreviewLine[],
    actionPath: ActionPath,
    deleted: boolean = false
): number {
    for (let i = 0; i < lines.length; i++) {
        const linePath = lines[i].actionPath;
        if (
            linePath?.kind === "action" &&
            ActionPath.equals(linePath, actionPath) &&
            lines[i].variant === "body" &&
            lines[i].pending !== true &&
            (lines[i].deleted === true) === deleted
        )
            return i;
    }
    return -1;
}

function findActionEndIndex(
    lines: PreviewLine[],
    actionPath: ActionPath,
    startIdx: number
): number {
    let endIdx = startIdx;
    for (let i = startIdx + 1; i < lines.length; i++) {
        const ap = lines[i].actionPath;
        const inScope = ap !== undefined && ActionTreePath.isWithinAction(ap, actionPath);
        if (inScope) {
            endIdx = i;
        } else {
            break;
        }
    }
    return endIdx;
}

function findDeletedActionEndIndex(
    lines: PreviewLine[],
    actionPath: ActionPath,
    startIdx: number
): number {
    let endIdx = startIdx;
    for (let i = startIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.deleted !== true) break;
        const linePath = line.actionPath;
        if (
            linePath === undefined ||
            !ActionTreePath.isWithinAction(linePath, actionPath)
        ) {
            break;
        }
        endIdx = i;
    }
    return endIdx;
}

function actionListPathsEqual(
    a: ActionListPath | undefined,
    b: ActionListPath | undefined
): boolean {
    if (a === undefined || b === undefined) return a === b;
    return ActionTreePath.equals(a, b);
}

function observedIndicesForList(
    lines: readonly PreviewLine[],
    listPath: ActionListPath | undefined
): number[] {
    const indices = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.pending === true || line.actionPath?.kind !== "action") continue;
        if (actionListPathsEqual(ActionPath.containingList(line.actionPath), listPath)) {
            indices.add(ActionPath.index(line.actionPath));
        }
    }
    return Array.from(indices).sort((a, b) => a - b);
}

function findIndexByPathVariant(
    lines: PreviewLine[],
    actionPath: ActionTreePath,
    variant: PreviewVariant
): number {
    for (let i = 0; i < lines.length; i++) {
        const linePath = lines[i].actionPath;
        if (
            linePath !== undefined &&
            ActionTreePath.equals(linePath, actionPath) &&
            lines[i].variant === variant &&
            lines[i].deleted !== true
        ) {
            return i;
        }
    }
    return -1;
}

function insertionIndexForPath(lines: PreviewLine[], actionPath: ActionPath): number {
    const existing = findActionStartIndex(lines, actionPath);
    if (existing >= 0) return existing;

    const lastIdx = ActionPath.index(actionPath);
    const listPath = ActionPath.containingList(actionPath);
    if (lastIdx > 0) {
        const siblingPath = ActionPath.at(listPath, lastIdx - 1);
        const siblingStart = findIndexByPathVariant(lines, siblingPath, "body");
        if (siblingStart >= 0) {
            return findActionEndIndex(lines, siblingPath, siblingStart) + 1;
        }
    }

    if (listPath !== undefined) {
        const parentPath = ActionTreePath.parentAction(listPath);
        const prop = listPath.parts[listPath.parts.length - 1];
        if (parentPath === null) return lines.length;
        if (prop === "elseActions") {
            const elseIdx = findIndexByPathVariant(lines, parentPath, "else");
            if (elseIdx >= 0) return elseIdx + 1;
            const closeIdx = findIndexByPathVariant(lines, parentPath, "close");
            if (closeIdx >= 0) return closeIdx;
        } else {
            const bodyIdx = findIndexByPathVariant(lines, parentPath, "body");
            if (bodyIdx >= 0) return bodyIdx + 1;
        }
    }

    return lines.length;
}

function linesForImportable(importable: Importable, shellOnly: boolean): PreviewLine[] {
    const out: PreviewLine[] = [];
    if (importable.type === "FUNCTION" || importable.type === "EVENT") {
        appendActions(
            out,
            nodesFromActions(importable.actions ?? []),
            undefined,
            0,
            shellOnly
        );
    } else if (importable.type === "REGION") {
        appendActions(
            out,
            nodesFromActions(importable.onEnterActions ?? []),
            undefined,
            0,
            shellOnly
        );
    }
    renumberLines(out);
    return out;
}

function nodesFromActions(actions: readonly Action[]): ObservedNode[] {
    return actions.map((action) => ({ kind: "action", action }));
}

function buildLines(
    nodes: readonly ObservedNode[],
    listPath: ActionListPath | undefined,
    depth: number
): PreviewLine[] {
    const out: PreviewLine[] = [];
    appendActions(out, nodes, listPath, depth, false);
    renumberLines(out);
    return out;
}

function appendActions(
    out: PreviewLine[],
    nodes: readonly ObservedNode[],
    listPath: ActionListPath | undefined,
    depth: number,
    shellOnly: boolean
): void {
    for (let i = 0; i < nodes.length; i++) {
        appendActionLines(out, nodes[i], listPath, i, depth, shellOnly);
    }
}

function appendActionLines(
    out: PreviewLine[],
    node: ObservedNode,
    listPath: ActionListPath | undefined,
    index: number,
    depth: number,
    shellOnly: boolean
): void {
    const actionPath = ActionPath.at(listPath, index);
    switch (node.kind) {
        case "unknown":
            out.push(makePlaceholderSlot(listPath, index, depth, actionPath));
            return;
        case "action":
            appendKnownActionLines(
                out,
                node.action,
                node.action,
                undefined,
                actionPath,
                depth,
                shellOnly
            );
            return;
        case "partial":
            appendKnownActionLines(
                out,
                node.action,
                undefined,
                node.childLists,
                actionPath,
                depth,
                shellOnly
            );
            return;
    }
}

function appendKnownActionLines(
    out: PreviewLine[],
    action: Observed,
    completeAction: Action | undefined,
    childLists: Extract<ObservedNode, { kind: "partial" }>["childLists"] | undefined,
    actionPath: ActionPath,
    depth: number,
    shellOnly: boolean
): void {
    if (action.type === "CONDITIONAL") {
        const conditions: ObservedChildList | undefined =
            completeAction?.type === "CONDITIONAL"
                ? { state: "conditions", entries: completeAction.conditions }
                : childLists?.conditions;
        const condText = shellOnly
            ? `${action.matchAny ? "or " : ""}(...conditions...)`
            : formatConditionsHead(action.matchAny ?? false, conditions);
        const headText = `${indent(depth)}if ${condText} {`;
        out.push(
            makeLine({
                variant: "body",
                actionPath,
                text: headText,
                depth,
            })
        );
        if (!shellOnly) {
            const ifActions: ObservedChildList | undefined =
                completeAction?.type === "CONDITIONAL"
                    ? {
                          state: "actions",
                          entries: nodesFromActions(completeAction.ifActions),
                      }
                    : childLists?.ifActions;
            appendChildListBody(
                out,
                ifActions,
                actionPath,
                "ifActions",
                depth + 1,
                shellOnly
            );
            const elseActions: ObservedChildList | undefined =
                completeAction?.type === "CONDITIONAL"
                    ? {
                          state: "actions",
                          entries: nodesFromActions(completeAction.elseActions),
                      }
                    : childLists?.elseActions;
            if (childListLength(elseActions) > 0) {
                const elseText = `${indent(depth)}} else {`;
                out.push(
                    makeLine({
                        variant: "else",
                        actionPath,
                        text: elseText,
                        depth,
                    })
                );
                appendChildListBody(
                    out,
                    elseActions,
                    actionPath,
                    "elseActions",
                    depth + 1,
                    shellOnly
                );
            }
        }
        out.push(
            makeLine({
                variant: "close",
                actionPath,
                text: `${indent(depth)}}`,
                depth,
            })
        );
        return;
    }
    if (action.type === "RANDOM") {
        out.push(
            makeLine({
                variant: "body",
                actionPath,
                text: `${indent(depth)}random {`,
                depth,
            })
        );
        if (!shellOnly) {
            const actions: ObservedChildList | undefined =
                completeAction?.type === "RANDOM"
                    ? {
                          state: "actions",
                          entries: nodesFromActions(completeAction.actions),
                      }
                    : childLists?.actions;
            appendChildListBody(
                out,
                actions,
                actionPath,
                "actions",
                depth + 1,
                shellOnly
            );
        }
        out.push(
            makeLine({
                variant: "close",
                actionPath,
                text: `${indent(depth)}}`,
                depth,
            })
        );
        return;
    }
    out.push(
        makeLine({
            variant: "body",
            actionPath,
            text: `${indent(depth)}${printActionOneLine(action)}`,
            depth,
        })
    );
}

function appendChildListBody(
    out: PreviewLine[],
    childList: ObservedChildList | undefined,
    parentPath: ActionPath,
    prop: ChildActionListName,
    depth: number,
    shellOnly: boolean
): void {
    if (childList === undefined) return;
    switch (childList.state) {
        case "summary":
            appendChildListSummary(out, childList.types.length, parentPath, prop, depth);
            return;
        case "conditions":
            return;
        case "actions":
            if (childList.entries.length === 0) return;
            if (shellOnly) {
                appendChildListSummary(
                    out,
                    childList.entries.length,
                    parentPath,
                    prop,
                    depth
                );
                return;
            }
            appendActions(
                out,
                childList.entries,
                ActionListPath.childOf(parentPath, prop),
                depth,
                shellOnly
            );
            return;
    }
}

function appendChildListSummary(
    out: PreviewLine[],
    count: number,
    parentPath: ActionPath,
    prop: ChildActionListName,
    depth: number
): void {
    if (count === 0) return;
    const childListPath = ActionListPath.childOf(parentPath, prop);
    const noun = count === 1 ? "action" : "actions";
    out.push(
        makeLine({
            variant: "placeholder",
            actionPath: childListPath,
            text: `${indent(depth)}...${count} ${noun}...`,
            depth,
            lineNum: 0,
            italic: true,
        })
    );
}

function childListLength(childList: ObservedChildList | undefined): number {
    if (childList === undefined) return 0;
    switch (childList.state) {
        case "summary":
            return childList.types.length;
        case "conditions":
        case "actions":
            return childList.entries.length;
    }
}

function makePlaceholderSlot(
    listPath: ActionListPath | undefined,
    idx: number,
    depth: number,
    actionPath: ActionPath
): PreviewLine {
    const ownerKey = listPath === undefined ? String(idx) : ActionTreePath.key(listPath);
    return makeLine({
        id: `${ownerKey}:slot${idx}:placeholder`,
        variant: "placeholder",
        actionPath,
        text: `${indent(depth)}...`,
        depth,
        lineNum: 0,
        italic: true,
    });
}

function formatConditionsHead(
    matchAny: boolean,
    childList: ObservedChildList | undefined
): string {
    const mode = matchAny ? "or " : "";
    if (childList === undefined) {
        return `${mode}(...conditions...)`;
    }
    if (childList.state === "summary") {
        return `${mode}(...${childList.types.length} conditions...)`;
    }
    if (childList.state !== "conditions") {
        return `${mode}(...conditions...)`;
    }
    const conds = childList.entries;
    if (conds.length === 0) return `${mode}()`;
    const parts: string[] = [];
    let allKnown = true;
    for (let i = 0; i < conds.length; i++) {
        const c = conds[i];
        if (c === null) {
            allKnown = false;
            break;
        }
        let printed: string;
        try {
            printed = htsw.htsl.printCondition(c);
        } catch (_e) {
            allKnown = false;
            break;
        }
        parts.push(printed);
    }
    if (!allKnown) {
        return `${mode}(...${conds.length} conditions...)`;
    }
    return `${mode}(${parts.join(", ")})`;
}

function indent(depth: number): string {
    let s = "";
    for (let i = 0; i < depth; i++) s += "    ";
    return s;
}

function printActionOneLine(action: Observed): string {
    let text: string;
    try {
        text = htsw.htsl.printAction(normalizeActionForPreview(action) as never);
    } catch (_e) {
        return `${action.type.toLowerCase()} ...`;
    }
    const split = text.split("\n");
    return split.length > 0 ? split[0] : text;
}

function normalizeActionForPreview(action: Observed): Observed {
    if (action.type !== "PLAY_SOUND") return action;
    const normalized = { ...action } as Record<string, unknown>;
    if (typeof normalized.sound === "string") {
        normalized.sound = normalizeSoundKey(normalized.sound) ?? normalized.sound;
    }
    if (typeof normalized.volume === "string") {
        const volume = Number(normalized.volume);
        if (isFinite(volume)) normalized.volume = volume;
    }
    if (typeof normalized.pitch === "string") {
        const pitch = Number(normalized.pitch);
        if (isFinite(pitch)) normalized.pitch = pitch;
    }
    if (typeof normalized.location === "string") {
        if (normalized.location === "Not Set") {
            delete normalized.location;
        } else {
            normalized.location = { type: normalized.location };
        }
    }
    return normalized as Observed;
}

function makeLine(opts: {
    variant: PreviewVariant;
    actionPath?: ActionTreePath;
    text: string;
    depth: number;
    lineNum?: number;
    italic?: boolean;
    diffState?: DiffState;
    completed?: boolean;
    id?: string;
}): PreviewLine {
    return {
        id:
            opts.id ??
            computeLineId({ variant: opts.variant, actionPath: opts.actionPath }),
        variant: opts.variant,
        actionPath: opts.actionPath,
        tokens: tokenizeHtsl(opts.text),
        depth: opts.depth,
        lineNum: opts.lineNum ?? 0,
        italic: opts.italic,
        diffState: opts.diffState,
        completed: opts.completed,
    };
}

function renumberLines(lines: PreviewLine[]): void {
    let n = 1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].variant === "ghost" || lines[i].variant === "placeholder") {
            lines[i].lineNum = 0;
            continue;
        }
        lines[i].lineNum = n;
        n++;
    }
}

function lineHasCompletedRead(
    line: PreviewLine,
    completedPaths: Map<ActionPathKey, ActionPath>
): boolean {
    if (line.variant === "placeholder" || line.actionPath === undefined) return false;
    let probe = ActionTreePath.nearestAction(line.actionPath);
    while (probe !== null) {
        if (completedPaths.has(ActionPath.key(probe))) return true;
        probe = ActionTreePath.parentAction(probe);
    }
    return false;
}

function applyReadCompletions(
    lines: PreviewLine[],
    completedPaths: Map<ActionPathKey, ActionPath>
): boolean {
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!lineHasCompletedRead(line, completedPaths)) continue;
        if (line.completed !== true || line.diffState !== undefined) {
            line.completed = true;
            line.diffState = undefined;
            changed = true;
        }
    }
    return changed;
}

function rebuildObserved(s: FileState, nodes: readonly ObservedNode[]): void {
    s.lastObservedAt = Date.now();
    s.rebasedListKeys.clear();
    s.lines = buildLines(nodes, undefined, 0);
    applyReadCompletions(s.lines, s.readCompletedPaths);
    s.hasContent = true;
    bump(s);
}

function flushPendingObserved(s: FileState): void {
    if (
        s.pendingNodes === undefined ||
        Date.now() - s.lastObservedAt < OBSERVED_REBUILD_THROTTLE_MS
    ) {
        return;
    }
    const nodes = s.pendingNodes;
    s.pendingNodes = undefined;
    rebuildObserved(s, nodes);
}

// ── Exported query / mutation API ───────────────────────────────────

export function previewLinesForFile(path: string): readonly PreviewLine[] {
    const k = keyForFile(path);
    const s = states.get(k);
    if (s !== undefined) flushPendingObserved(s);
    return s ? s.lines : [];
}

/**
 * Change counter for one file's preview lines. Every line mutation bumps it
 * (see `bump`), so it keys caches derived from the line array — the line
 * objects are mutated in place, so array identity alone can't.
 */
export function previewRevision(path: string): number {
    const s = states.get(keyForFile(path));
    if (s === undefined) return -1;
    flushPendingObserved(s);
    return s.revision;
}

export function resetPreview(path: string): void {
    removeState(keyForFile(path));
}

export function hasPreviewState(path: string): boolean {
    return states.has(keyForFile(path));
}

export function disposePreview(path: string): void {
    removeState(keyForFile(path));
}

export function beginPreviewRead(path: string): void {
    const state = states.get(keyForFile(path));
    if (state === undefined) return;
    state.readCompletedPaths.clear();
    state.pendingNodes = undefined;
    state.rebasedListKeys.clear();
    state.lastObservedAt = 0;
}

export function markPreviewCompleted(path: string): void {
    const state = states.get(keyForFile(path));
    if (state !== undefined) state.evictionEligible = true;
}

export function disposeLivePreviews(): void {
    if (states.size === 0) return;
    states.clear();
    markGuiDirty();
}

export function livePreviewCacheSize(): number {
    return states.size;
}

export function primeWithCache(
    path: string,
    importable: Importable | null,
    options?: { shellOnly?: boolean }
): void {
    const s = ensure(path);
    const shellOnly = options?.shellOnly === true;
    s.rebasedListKeys.clear();
    s.lines = importable === null ? [] : linesForImportable(importable, shellOnly);
    s.hasContent = importable !== null;
    bump(s);
}

export function setObservedTopLevel(
    path: string,
    nodes: readonly ObservedNode[],
    options?: { force?: boolean }
): void {
    const s = ensure(path);
    const now = Date.now();
    if (options?.force === true) {
        s.pendingNodes = undefined;
        rebuildObserved(s, nodes);
        return;
    }
    if (s.hasContent && now - s.lastObservedAt < OBSERVED_REBUILD_THROTTLE_MS) {
        s.pendingNodes = nodes;
        return;
    }
    s.pendingNodes = undefined;
    rebuildObserved(s, nodes);
}

export function buildObservedToDesiredIndexMap(
    observedIndices: readonly number[],
    listPath: ActionListPath | undefined,
    operations: readonly PlannedOp[],
    matches: readonly ActionPath[]
): Map<number, number> | null {
    const observed = new Set(observedIndices);
    const consumed = new Set<number>();
    const indexMap = new Map<number, number>();

    for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        if (
            !actionListPathsEqual(ActionPath.containingList(op.path), listPath) ||
            op.op === "add"
        ) {
            continue;
        }
        if (!observed.has(op.fromIndex)) return null;
        consumed.add(op.fromIndex);
        if (op.op === "edit" || op.op === "move") {
            indexMap.set(op.fromIndex, op.toIndex);
        }
    }

    const desiredMatches: number[] = [];
    const seenDesiredMatches = new Set<number>();
    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        if (!actionListPathsEqual(ActionPath.containingList(match), listPath)) {
            continue;
        }
        const desiredIndex = ActionPath.index(match);
        if (seenDesiredMatches.has(desiredIndex)) return null;
        seenDesiredMatches.add(desiredIndex);
        desiredMatches.push(desiredIndex);
    }
    desiredMatches.sort((a, b) => a - b);

    const unmatchedObserved = Array.from(observed)
        .filter((index) => !consumed.has(index))
        .sort((a, b) => a - b);
    if (unmatchedObserved.length !== desiredMatches.length) return null;

    for (let i = 0; i < unmatchedObserved.length; i++) {
        indexMap.set(unmatchedObserved[i], desiredMatches[i]);
    }
    return indexMap;
}

export function rebaseToDesired(
    path: string,
    listPath: ActionListPath | undefined,
    operations: readonly PlannedOp[],
    matches: readonly ActionPath[]
): void {
    const s = ensure(path);
    const listKey = listPath === undefined ? "root" : ActionTreePath.key(listPath);
    if (s.rebasedListKeys.has(listKey)) return;

    const indexMap = buildObservedToDesiredIndexMap(
        observedIndicesForList(s.lines, listPath),
        listPath,
        operations,
        matches
    );
    if (indexMap === null) return;

    for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        if (
            op.op !== "delete" ||
            !actionListPathsEqual(ActionPath.containingList(op.path), listPath)
        ) {
            continue;
        }
        const startIdx = findActionStartIndex(s.lines, op.path);
        if (startIdx < 0) continue;
        const endIdx = findActionEndIndex(s.lines, op.path, startIdx);
        for (let lineIndex = startIdx; lineIndex <= endIdx; lineIndex++) {
            s.lines[lineIndex].deleted = true;
        }
    }

    for (let i = 0; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (line.deleted === true || line.actionPath === undefined) continue;
        const observedIndex = ActionTreePath.indexAtList(line.actionPath, listPath);
        if (observedIndex === null) continue;
        const desiredIndex = indexMap.get(observedIndex);
        if (desiredIndex === undefined) continue;
        const rebased = ActionTreePath.replaceIndexAtList(
            line.actionPath,
            listPath,
            desiredIndex
        );
        if (rebased !== null) line.actionPath = rebased;
    }
    for (let i = 0; i < s.lines.length; i++) {
        s.lines[i].id = computeLineId(s.lines[i]);
    }
    renumberLines(s.lines);
    s.rebasedListKeys.add(listKey);
    bump(s);
}

export function markReadComplete(path: string, actionPath: ActionPath): void {
    const s = ensure(path);
    s.readCompletedPaths.set(ActionPath.key(actionPath), actionPath);
    if (applyReadCompletions(s.lines, s.readCompletedPaths)) bump(s);
}

export function markPlannedAdd(
    path: string,
    actionPath: ActionPath,
    desired: Action,
    _toIndex: number
): void {
    const s = ensure(path);
    for (let i = 0; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (
            line.pending === true &&
            line.actionPath?.kind === "action" &&
            ActionPath.equals(line.actionPath, actionPath) &&
            line.variant === "body"
        ) {
            return;
        }
    }
    const insertAt = insertionIndexForPath(s.lines, actionPath);
    const depth = ActionPath.depth(actionPath);
    const newLines: PreviewLine[] = [];
    appendActionLines(
        newLines,
        { kind: "action", action: desired },
        ActionPath.containingList(actionPath),
        ActionPath.index(actionPath),
        depth,
        false
    );
    for (let i = 0; i < newLines.length; i++) {
        newLines[i].diffState = "add";
    }
    markLinesPending(newLines);
    s.lines.splice(insertAt, 0, ...newLines);
    renumberLines(s.lines);
    bump(s);
}

export function markPlannedEdit(
    path: string,
    actionPath: ActionPath,
    _observed: Action,
    desired: Action
): void {
    const s = ensure(path);
    const startIdx = findActionStartIndex(s.lines, actionPath);
    if (startIdx < 0) return;
    // diffPlanned arrives twice per list (after reading, again when the apply
    // starts); a still-pending ghost means this edit is already marked.
    if (findIndexByPathVariant(s.lines, actionPath, "ghost") >= 0) return;
    s.lines[startIdx].diffState = "delete";
    const depth = s.lines[startIdx].depth;
    const ghostText = `${indent(depth)}${printActionOneLine(desired)}`;
    const ghost = makeLine({
        variant: "ghost",
        actionPath,
        text: ghostText,
        depth,
        diffState: "add",
    });
    s.lines.splice(startIdx + 1, 0, ghost);
    renumberLines(s.lines);
    bump(s);
}

export function markPlannedDelete(path: string, actionPath: ActionPath): void {
    const s = ensure(path);
    let startIdx = findActionStartIndex(s.lines, actionPath, true);
    const alreadyDeleted = startIdx >= 0;
    if (startIdx < 0) startIdx = findActionStartIndex(s.lines, actionPath);
    if (startIdx < 0) return;
    const endIdx = alreadyDeleted
        ? findDeletedActionEndIndex(s.lines, actionPath, startIdx)
        : findActionEndIndex(s.lines, actionPath, startIdx);
    for (let i = startIdx; i <= endIdx; i++) {
        s.lines[i].diffState = "delete";
        s.lines[i].deleted = true;
    }
    bump(s);
}

export function markPlannedMove(
    path: string,
    actionPath: ActionPath,
    _fromIndex: number,
    _toIndex: number
): void {
    const s = ensure(path);
    const startIdx = findActionStartIndex(s.lines, actionPath);
    if (startIdx < 0) return;
    s.lines[startIdx].diffState = "edit";
    bump(s);
}

export function applyComplete(
    path: string,
    actionPath: ActionPath,
    _finalState: DiffFinalState,
    kind: DiffOpKind
): void {
    const s = ensure(path);
    if (kind === "delete") {
        const startIdx = findActionStartIndex(s.lines, actionPath, true);
        if (startIdx < 0) return;
        const endIdx = findDeletedActionEndIndex(s.lines, actionPath, startIdx);
        s.lines.splice(startIdx, endIdx - startIdx + 1);
        renumberLines(s.lines);
        bump(s);
        return;
    }
    if (kind === "edit") {
        const startIdx = findActionStartIndex(s.lines, actionPath);
        if (startIdx < 0) return;
        let ghostIdx = -1;
        const ghostId = `${ActionPath.key(actionPath)}:ghost`;
        for (let i = startIdx + 1; i < s.lines.length; i++) {
            if (s.lines[i].id === ghostId) {
                ghostIdx = i;
                break;
            }
        }
        if (ghostIdx >= 0) {
            const ghost = s.lines[ghostIdx];
            ghost.italic = false;
            ghost.variant = "body";
            ghost.diffState = undefined;
            ghost.completed = true;
            ghost.id = computeLineId(ghost);
            s.lines.splice(ghostIdx, 1);
            s.lines.splice(startIdx, 1, ghost);
        } else {
            s.lines[startIdx].diffState = undefined;
            s.lines[startIdx].completed = true;
        }
        renumberLines(s.lines);
        bump(s);
        return;
    }
    if (kind === "add") {
        let firstAdded = -1;
        let lastAdded = -1;
        for (let i = 0; i < s.lines.length; i++) {
            const line = s.lines[i];
            if (line.deleted === true || line.actionPath === undefined) continue;
            if (!ActionTreePath.isWithinAction(line.actionPath, actionPath)) continue;
            if (line.pending !== true) continue;
            if (firstAdded < 0) firstAdded = i;
            lastAdded = i;
        }
        if (firstAdded < 0) {
            const startIdx = findActionStartIndex(s.lines, actionPath);
            if (startIdx < 0) return;
            const endIdx = findActionEndIndex(s.lines, actionPath, startIdx);
            for (let i = startIdx; i <= endIdx; i++) {
                if (s.lines[i].deleted === true) continue;
                s.lines[i].diffState = undefined;
                s.lines[i].completed = true;
            }
            bump(s);
            return;
        }
        for (let i = firstAdded; i <= lastAdded; i++) {
            const line = s.lines[i];
            if (line.pending === true) setPending(line, false);
            line.diffState = undefined;
            line.completed = true;
        }
        renumberLines(s.lines);
        bump(s);
        return;
    }
    const startIdx = findActionStartIndex(s.lines, actionPath);
    if (startIdx < 0) return;
    s.lines[startIdx].diffState = undefined;
    s.lines[startIdx].completed = true;
    bump(s);
}

export function markHeadApplied(path: string, actionPath: ActionPath): void {
    const s = ensure(path);
    let bodyIdx = -1;
    for (let i = 0; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (
            line.actionPath?.kind === "action" &&
            ActionPath.equals(line.actionPath, actionPath) &&
            line.variant === "body" &&
            line.deleted !== true
        ) {
            bodyIdx = i;
            break;
        }
    }
    if (bodyIdx < 0) return;

    let ghostIdx = -1;
    for (let i = bodyIdx + 1; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (
            line.actionPath?.kind === "action" &&
            ActionPath.equals(line.actionPath, actionPath) &&
            line.variant === "ghost" &&
            line.deleted !== true
        ) {
            ghostIdx = i;
            break;
        }
    }
    if (ghostIdx >= 0) {
        const ghost = s.lines[ghostIdx];
        ghost.italic = false;
        ghost.variant = "body";
        ghost.diffState = undefined;
        ghost.completed = true;
        setPending(ghost, false);
        s.lines.splice(ghostIdx, 1);
        s.lines.splice(bodyIdx, 1, ghost);
    } else {
        const body = s.lines[bodyIdx];
        if (body.pending === true) setPending(body, false);
        body.diffState = undefined;
        body.completed = true;
    }

    for (let i = 0; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (
            line.actionPath?.kind !== "action" ||
            !ActionPath.equals(line.actionPath, actionPath) ||
            line.deleted === true
        )
            continue;
        if (line.variant !== "else" && line.variant !== "close") continue;
        if (line.pending === true) setPending(line, false);
        line.diffState = undefined;
        line.completed = true;
    }

    renumberLines(s.lines);
    bump(s);
}

export function effectiveFocusActionPath(
    path: string,
    actionPath: ActionTreePath
): ActionPath | null {
    const s = states.get(keyForFile(path));
    if (s === undefined) return null;
    let probe = ActionTreePath.nearestAction(actionPath);
    while (probe !== null) {
        for (let i = 0; i < s.lines.length; i++) {
            const line = s.lines[i];
            if (
                line.actionPath?.kind === "action" &&
                ActionPath.equals(line.actionPath, probe) &&
                line.variant === "body" &&
                line.deleted !== true
            ) {
                return probe;
            }
        }
        probe = ActionTreePath.parentAction(probe);
    }
    return null;
}

export function previewLineIdForPath(path: string, actionPath: ActionTreePath): string {
    const effective = effectiveFocusActionPath(path, actionPath);
    if (effective === null) {
        const nearest = ActionTreePath.nearestAction(actionPath);
        return computeLineId({ actionPath: nearest ?? actionPath, variant: "body" });
    }
    const s = states.get(keyForFile(path));
    if (s !== undefined) {
        for (let i = 0; i < s.lines.length; i++) {
            const line = s.lines[i];
            if (
                line.actionPath?.kind === "action" &&
                ActionPath.equals(line.actionPath, effective) &&
                line.variant === "body" &&
                line.pending === true &&
                line.deleted !== true
            ) {
                return line.id;
            }
        }
        for (let i = 0; i < s.lines.length; i++) {
            const line = s.lines[i];
            if (
                line.actionPath?.kind === "action" &&
                ActionPath.equals(line.actionPath, effective) &&
                line.variant === "body" &&
                line.deleted !== true
            ) {
                return line.id;
            }
        }
    }
    return computeLineId({ actionPath: effective, variant: "body" });
}

export function finalizeFromSource(path: string, actions: ReadonlyArray<Action>): void {
    const s = ensure(path);
    const out: PreviewLine[] = [];
    appendActions(out, nodesFromActions(actions), undefined, 0, false);
    for (let i = 0; i < out.length; i++) {
        out[i].completed = true;
        out[i].diffState = undefined;
    }
    renumberLines(out);
    s.lines = out;
    s.hasContent = true;
    bump(s);
}

// ── Live cursor / phase + match tagging ───────────────────────────────
//
// Per-line diff state lives on the `PreviewLine`s themselves (set by the
// `markPlanned*` / `applyComplete` mutators above). The only live state that
// isn't per-line is the cursor and the phase flag, kept as two scalars below.

export function getCurrentPath(path: string): ActionTreePath | null {
    return states.get(keyForFile(path))?.currentPath ?? null;
}

export function getLiveSummary(path: string): DiffSummary | null {
    return states.get(keyForFile(path))?.summary ?? null;
}

export function setCurrent(path: string, actionPath: ActionTreePath | null): void {
    const s = ensure(path);
    if (
        (s.currentPath === null && actionPath === null) ||
        (s.currentPath !== null &&
            actionPath !== null &&
            ActionTreePath.equals(s.currentPath, actionPath))
    )
        return;
    s.currentPath = actionPath;
    markGuiDirty();
}

export function setLiveSummary(path: string, summary: DiffSummary): void {
    const s = ensure(path);
    if (s.pendingNodes !== undefined) {
        const nodes = s.pendingNodes;
        s.pendingNodes = undefined;
        rebuildObserved(s, nodes);
    }
    if (s.summary === summary) return;
    s.summary = summary;
    markGuiDirty();
}

/**
 * Mark an action's line(s) as matched — i.e. already in sync with the desired
 * state, nothing to do. Renders as a completed (done) line. Used for untouched
 * actions and no-op edits, which the diff plan reports as matches.
 */
export function markMatch(path: string, actionPath: ActionPath): void {
    const s = ensure(path);
    let changed = false;
    for (let i = 0; i < s.lines.length; i++) {
        const linePath = s.lines[i].actionPath;
        if (
            s.lines[i].deleted !== true &&
            linePath?.kind === "action" &&
            ActionPath.equals(linePath, actionPath)
        ) {
            s.lines[i].completed = true;
            s.lines[i].diffState = undefined;
            changed = true;
        }
    }
    if (changed) bump(s);
}
