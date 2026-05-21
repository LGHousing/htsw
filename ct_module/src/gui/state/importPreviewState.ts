/// <reference types="../../../CTAutocomplete" />

/**
 * Mutable per-importable preview model used by the Import tab's live file view.
 *
 * Built up over time as the importer reads housing state and applies the diff.
 * `livePreviewBody` reads `previewLinesForFile` each frame to render.
 *
 * Lifecycle: primeWithCache → setObservedTopLevel (re-emitted after each
 * hydration step) → markPlanned{Add,Edit,Delete,Move} → applyComplete(s) →
 * finalizeFromSource.
 *
 * Line ids:
 *   <actionPath>:body         primary line for the action
 *   <actionPath>:else         `} else {` for CONDITIONAL with elseActions
 *   <actionPath>:close        closing `}` for CONDITIONAL/RANDOM
 *   <actionPath>:ghost        gold preview-of-desired below an editing body
 *   <parentPath>.<prop>:placeholder         consolidated `...N actions...`
 *   <parentPath>.<prop>:slot<i>:placeholder per-slot `...` for mixed-hydration
 *   __add::<id>               pending-add variant of any of the above
 */

import * as htsw from "htsw";
import type { Action, Importable } from "htsw/types";
import type { TokenSpan, FieldSpan } from "../code-view/types";
import type { DiffState } from "./diff";
import type { DiffFinalState, DiffOpKind } from "../../importer/importPreviewEvents";
import { tokenizeHtsl } from "../right-panel/syntax";
import { normalizeHtswPath } from "../lib/pathDisplay";

type MaybeAction = Action;
type MaybeNestedActions = ReadonlyArray<Action | null>;

export type PreviewLine = {
    id: string;
    actionPath?: string;
    tokens: TokenSpan[];
    fieldSpans?: readonly FieldSpan[];
    depth: number;
    lineNum: number;
    italic?: boolean;
    isPlaceholder?: boolean;
    isGhost?: boolean;
    diffState?: DiffState;
    completed?: boolean;
};

type FileState = {
    lines: PreviewLine[];
    revision: number;
    hasContent: boolean;
};

const states: { [key: string]: FileState } = {};

function keyForFile(path: string): string {
    return normalizeHtswPath(path);
}

function ensure(path: string): FileState {
    const k = keyForFile(path);
    let s = states[k];
    if (!s) {
        s = { lines: [], revision: 0, hasContent: false };
        states[k] = s;
    }
    return s;
}

function bump(s: FileState): void {
    s.revision = s.revision + 1;
}

export function previewLinesForFile(path: string): readonly PreviewLine[] {
    const k = keyForFile(path);
    const s = states[k];
    return s ? s.lines : [];
}

export function resetPreview(path: string): void {
    const k = keyForFile(path);
    delete states[k];
}

export function primeWithCache(path: string, importable: Importable | null): void {
    const s = ensure(path);
    s.lines = importable === null ? [] : linesForImportable(importable);
    s.hasContent = importable !== null;
    bump(s);
}

export function setObservedTopLevel(
    path: string,
    actions: ReadonlyArray<MaybeAction | null>
): void {
    const s = ensure(path);
    s.lines = buildLines(actions, undefined, 0);
    s.hasContent = true;
    bump(s);
}

// Pending-add ids carry this prefix so they don't collide with an
// observed-pending-delete line at the same actionPath until the apply
// loop has run the delete. Stripped on applyComplete(kind:"add").
const ADD_ID_PREFIX = "__add::";

function rewriteIdsForAdd(lines: PreviewLine[]): void {
    for (let i = 0; i < lines.length; i++) {
        lines[i].id = ADD_ID_PREFIX + lines[i].id;
    }
}

export function markPlannedAdd(
    path: string,
    actionPath: string,
    desired: Action,
    _toIndex: number
): void {
    const s = ensure(path);
    // Skip when a parent planAdd has already inserted this action as part of
    // its subtree (outer CONDITIONAL planAdd inserts its inner ifActions; the
    // importer's recursive sync then fires planAdds for each inner child that
    // are already in the model).
    const expectedAddedId = `${ADD_ID_PREFIX}${actionPath}:body`;
    for (let i = 0; i < s.lines.length; i++) {
        if (s.lines[i].id === expectedAddedId) return;
    }
    const insertAt = insertionIndexForPath(s.lines, actionPath);
    const depth = depthForActionPath(actionPath);
    const newLines: PreviewLine[] = [];
    appendActionLines(newLines, desired, actionPath, depth);
    rewriteIdsForAdd(newLines);
    for (let i = 0; i < newLines.length; i++) {
        newLines[i].diffState = "add";
    }
    s.lines.splice(insertAt, 0, ...newLines);
    renumberLines(s.lines);
    bump(s);
}

export function markPlannedEdit(
    path: string,
    actionPath: string,
    _observed: Action,
    desired: Action
): void {
    const s = ensure(path);
    const startIdx = findActionStartIndex(s.lines, actionPath);
    if (startIdx < 0) return;
    s.lines[startIdx].diffState = "edit";
    const depth = s.lines[startIdx].depth;
    const ghostText = `${indent(depth)}${printActionOneLine(desired)}`;
    const ghost = makeLine({
        id: `${actionPath}:ghost`,
        actionPath,
        text: ghostText,
        depth,
        italic: true,
        isGhost: true,
        diffState: "edit",
    });
    s.lines.splice(startIdx + 1, 0, ghost);
    renumberLines(s.lines);
    bump(s);
}

export function markPlannedDelete(path: string, actionPath: string): void {
    const s = ensure(path);
    const startIdx = findActionStartIndex(s.lines, actionPath);
    if (startIdx < 0) return;
    const endIdx = findActionEndIndex(s.lines, actionPath, startIdx);
    for (let i = startIdx; i <= endIdx; i++) {
        s.lines[i].diffState = "delete";
    }
    bump(s);
}

export function markPlannedMove(
    path: string,
    actionPath: string,
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
    actionPath: string,
    _finalState: DiffFinalState,
    kind: DiffOpKind
): void {
    const s = ensure(path);
    if (kind === "delete") {
        const startIdx = findActionStartIndex(s.lines, actionPath);
        if (startIdx < 0) return;
        const endIdx = findActionEndIndex(s.lines, actionPath, startIdx);
        s.lines.splice(startIdx, endIdx - startIdx + 1);
        renumberLines(s.lines);
        bump(s);
        return;
    }
    if (kind === "edit") {
        const startIdx = findActionStartIndex(s.lines, actionPath);
        if (startIdx < 0) return;
        let ghostIdx = -1;
        const ghostId = `${actionPath}:ghost`;
        for (let i = startIdx + 1; i < s.lines.length; i++) {
            if (s.lines[i].id === ghostId) {
                ghostIdx = i;
                break;
            }
        }
        if (ghostIdx >= 0) {
            const ghost = s.lines[ghostIdx];
            ghost.italic = false;
            ghost.isGhost = false;
            ghost.diffState = undefined;
            ghost.completed = true;
            ghost.id = `${actionPath}:body`;
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
        // Pending-add lines were inserted with `__add::` prefix; strip + complete.
        // Match prefix + actionPath, requiring next char to be ":" (own body/else/close)
        // or "." (nested children) so we don't catch unrelated paths sharing a stem.
        const fullPrefix = `${ADD_ID_PREFIX}${actionPath}`;
        let firstAdded = -1;
        let lastAdded = -1;
        for (let i = 0; i < s.lines.length; i++) {
            const id = s.lines[i].id;
            if (id.indexOf(fullPrefix) !== 0) continue;
            const next = id.charAt(fullPrefix.length);
            if (next !== ":" && next !== ".") continue;
            if (firstAdded < 0) firstAdded = i;
            lastAdded = i;
        }
        if (firstAdded < 0) {
            const startIdx = findActionStartIndex(s.lines, actionPath);
            if (startIdx < 0) return;
            const endIdx = findActionEndIndex(s.lines, actionPath, startIdx);
            for (let i = startIdx; i <= endIdx; i++) {
                s.lines[i].diffState = undefined;
                s.lines[i].completed = true;
            }
            bump(s);
            return;
        }
        // Bottom-up applyDone fires inner adds before outer adds; inner children
        // already had their prefix stripped on their own pass. Idempotent strip.
        for (let i = firstAdded; i <= lastAdded; i++) {
            const id = s.lines[i].id;
            if (id.indexOf(ADD_ID_PREFIX) === 0) {
                s.lines[i].id = id.substring(ADD_ID_PREFIX.length);
            }
            s.lines[i].diffState = undefined;
            s.lines[i].completed = true;
        }
        // TODO(htsw#41-followup): move+add at the same actionPath can produce
        // two `<path>:body` lines after prefix strip. The matcher emits both a
        // MOVE for the observed and an ADD for the desired at the same source
        // path. The real fix is importer-side (one or the other should win).
        // For now: dedup positionally, keeping the latest insertion.
        const idCounts: { [id: string]: number[] } = {};
        for (let i = 0; i < s.lines.length; i++) {
            const id = s.lines[i].id;
            if (idCounts[id] === undefined) idCounts[id] = [];
            idCounts[id].push(i);
        }
        const dupIdsToRemove: number[] = [];
        for (const id in idCounts) {
            const positions = idCounts[id];
            if (positions.length <= 1) continue;
            for (let k = 0; k < positions.length - 1; k++) {
                dupIdsToRemove.push(positions[k]);
            }
        }
        if (dupIdsToRemove.length > 0) {
            dupIdsToRemove.sort((a, b) => b - a);
            for (let i = 0; i < dupIdsToRemove.length; i++) {
                s.lines.splice(dupIdsToRemove[i], 1);
            }
        }
        renumberLines(s.lines);
        bump(s);
        return;
    }
    if (kind === "move") {
        const startIdx = findActionStartIndex(s.lines, actionPath);
        if (startIdx < 0) return;
        s.lines[startIdx].diffState = undefined;
        s.lines[startIdx].completed = true;
        bump(s);
        return;
    }
}

/**
 * For block-bearing actions (CONDITIONAL/RANDOM), the head (conditions /
 * matchAny / random-mode) finalizes before inner ifActions/elseActions
 * sync starts. Flip body / else / close to vibrant without waiting for
 * inner ops. Strips the `__add::` prefix on those three when present;
 * inner children strip their own.
 */
export function markHeadApplied(path: string, actionPath: string): void {
    const s = ensure(path);
    const bodyId = `${actionPath}:body`;
    const addedBodyId = `${ADD_ID_PREFIX}${actionPath}:body`;
    let bodyIdx = -1;
    let bodyHasPrefix = false;
    for (let i = 0; i < s.lines.length; i++) {
        if (s.lines[i].id === bodyId) {
            bodyIdx = i;
            break;
        }
        if (s.lines[i].id === addedBodyId) {
            bodyIdx = i;
            bodyHasPrefix = true;
            break;
        }
    }
    if (bodyIdx < 0) return;

    const ghostId = `${actionPath}:ghost`;
    let ghostIdx = -1;
    for (let i = bodyIdx + 1; i < s.lines.length; i++) {
        if (s.lines[i].id === ghostId) {
            ghostIdx = i;
            break;
        }
    }
    if (ghostIdx >= 0) {
        const ghost = s.lines[ghostIdx];
        ghost.italic = false;
        ghost.isGhost = false;
        ghost.diffState = undefined;
        ghost.completed = true;
        ghost.id = bodyId;
        s.lines.splice(ghostIdx, 1);
        s.lines.splice(bodyIdx, 1, ghost);
    } else {
        if (bodyHasPrefix) s.lines[bodyIdx].id = bodyId;
        s.lines[bodyIdx].diffState = undefined;
        s.lines[bodyIdx].completed = true;
    }

    const elseId = `${actionPath}:else`;
    const closeId = `${actionPath}:close`;
    const addedElseId = `${ADD_ID_PREFIX}${actionPath}:else`;
    const addedCloseId = `${ADD_ID_PREFIX}${actionPath}:close`;
    for (let i = 0; i < s.lines.length; i++) {
        const id = s.lines[i].id;
        if (id === addedElseId) s.lines[i].id = elseId;
        else if (id === addedCloseId) s.lines[i].id = closeId;
        else if (id !== elseId && id !== closeId) continue;
        s.lines[i].diffState = undefined;
        s.lines[i].completed = true;
    }

    renumberLines(s.lines);
    bump(s);
}

export function previewLineIdForPath(path: string, actionPath: string): string {
    const k = keyForFile(path);
    const s = states[k];
    const unprefixedId = `${actionPath}:body`;
    if (s === undefined) return unprefixedId;
    const prefixedId = `${ADD_ID_PREFIX}${actionPath}:body`;
    for (let i = 0; i < s.lines.length; i++) {
        if (s.lines[i].id === prefixedId) return prefixedId;
    }
    return unprefixedId;
}

export function finalizeFromSource(
    path: string,
    actions: ReadonlyArray<Action>
): void {
    const s = ensure(path);
    const out: PreviewLine[] = [];
    appendActions(out, actions, undefined, 0);
    for (let i = 0; i < out.length; i++) {
        out[i].completed = true;
        out[i].diffState = undefined;
    }
    renumberLines(out);
    s.lines = out;
    s.hasContent = true;
    bump(s);
}

function findActionStartIndex(lines: PreviewLine[], actionPath: string): number {
    const id = `${actionPath}:body`;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].id === id) return i;
    }
    return -1;
}

function findActionEndIndex(
    lines: PreviewLine[],
    actionPath: string,
    startIdx: number
): number {
    const prefix = `${actionPath}.`;
    let endIdx = startIdx;
    for (let i = startIdx + 1; i < lines.length; i++) {
        const ap = lines[i].actionPath;
        const inScope =
            ap === actionPath ||
            (ap !== undefined && ap.indexOf(prefix) === 0);
        if (inScope) {
            endIdx = i;
        } else {
            break;
        }
    }
    return endIdx;
}

function depthForActionPath(actionPath: string): number {
    const parts = actionPath.split(".");
    return Math.floor((parts.length - 1) / 2);
}

function findIndexByIdAny(lines: PreviewLine[], unprefixedId: string): number {
    const prefixedId = `${ADD_ID_PREFIX}${unprefixedId}`;
    for (let i = 0; i < lines.length; i++) {
        const id = lines[i].id;
        if (id === unprefixedId || id === prefixedId) return i;
    }
    return -1;
}

function insertionIndexForPath(lines: PreviewLine[], actionPath: string): number {
    const existing = findActionStartIndex(lines, actionPath);
    if (existing >= 0) return existing;

    const parts = actionPath.split(".");
    const lastIdx = Number(parts[parts.length - 1]);
    if (isFinite(lastIdx) && lastIdx > 0) {
        const siblingParts = parts.slice(0, parts.length - 1);
        siblingParts.push(String(lastIdx - 1));
        const siblingPath = siblingParts.join(".");
        // Match both unprefixed (existing observed) and `__add::` prefixed
        // (just-inserted pending) siblings so sequential adds resolve in order.
        const siblingStart = findIndexByIdAny(lines, `${siblingPath}:body`);
        if (siblingStart >= 0) {
            return findActionEndIndex(lines, siblingPath, siblingStart) + 1;
        }
    }

    if (parts.length >= 3) {
        const parentPath = parts.slice(0, parts.length - 2).join(".");
        const prop = parts[parts.length - 2];
        if (prop === "elseActions") {
            const elseIdx = findIndexByIdAny(lines, `${parentPath}:else`);
            if (elseIdx >= 0) return elseIdx + 1;
            const closeIdx = findIndexByIdAny(lines, `${parentPath}:close`);
            if (closeIdx >= 0) return closeIdx;
        } else {
            const bodyIdx = findIndexByIdAny(lines, `${parentPath}:body`);
            if (bodyIdx >= 0) return bodyIdx + 1;
        }
    }

    return lines.length;
}

function linesForImportable(importable: Importable): PreviewLine[] {
    const out: PreviewLine[] = [];
    if (importable.type === "FUNCTION" || importable.type === "EVENT") {
        appendActions(out, importable.actions, undefined, 0);
    } else if (importable.type === "REGION") {
        appendActions(out, importable.onEnterActions ?? [], undefined, 0);
    }
    renumberLines(out);
    return out;
}

function buildLines(
    actions: ReadonlyArray<MaybeAction | null>,
    pathPrefix: string | undefined,
    depth: number
): PreviewLine[] {
    const out: PreviewLine[] = [];
    appendActions(out, actions, pathPrefix, depth);
    renumberLines(out);
    return out;
}

function appendActions(
    out: PreviewLine[],
    actions: ReadonlyArray<MaybeAction | null>,
    pathPrefix: string | undefined,
    depth: number
): void {
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const path = pathPrefix === undefined ? String(i) : `${pathPrefix}.${i}`;
        if (action === null) {
            const lastDot = path.lastIndexOf(".");
            const parentDotted = lastDot >= 0 ? path.substring(0, lastDot) : path;
            out.push(makePlaceholderSlot(parentDotted, i, depth, path));
            continue;
        }
        appendActionLines(out, action, path, depth);
    }
}

function appendActionLines(
    out: PreviewLine[],
    action: MaybeAction,
    actionPath: string,
    depth: number
): void {
    if (action.type === "CONDITIONAL") {
        const headText = `${indent(depth)}if ${formatConditionsHead(action)} {`;
        out.push(makeLine({
            id: `${actionPath}:body`,
            actionPath,
            text: headText,
            depth,
        }));
        appendNestedListBody(out, action.ifActions, actionPath, "ifActions", depth + 1);
        if (action.elseActions !== undefined && action.elseActions !== null && action.elseActions.length > 0) {
            const elseText = `${indent(depth)}} else {`;
            out.push(makeLine({
                id: `${actionPath}:else`,
                actionPath,
                text: elseText,
                depth,
            }));
            appendNestedListBody(out, action.elseActions, actionPath, "elseActions", depth + 1);
        }
        out.push(makeLine({
            id: `${actionPath}:close`,
            actionPath,
            text: `${indent(depth)}}`,
            depth,
        }));
        return;
    }
    if (action.type === "RANDOM") {
        out.push(makeLine({
            id: `${actionPath}:body`,
            actionPath,
            text: `${indent(depth)}random {`,
            depth,
        }));
        appendNestedListBody(out, action.actions, actionPath, "actions", depth + 1);
        out.push(makeLine({
            id: `${actionPath}:close`,
            actionPath,
            text: `${indent(depth)}}`,
            depth,
        }));
        return;
    }
    out.push(makeLine({
        id: `${actionPath}:body`,
        actionPath,
        text: `${indent(depth)}${printActionOneLine(action)}`,
        depth,
    }));
}

function appendNestedListBody(
    out: PreviewLine[],
    nested: MaybeNestedActions | null | undefined,
    parentPath: string,
    prop: string,
    depth: number
): void {
    if (nested === null || nested === undefined || nested.length === 0) {
        return;
    }
    // Fully-unhydrated: collapse to one `...N actions...` placeholder so the
    // user sees the known count rather than N separate `...` slot lines.
    let allNull = true;
    for (let i = 0; i < nested.length; i++) {
        if (nested[i] !== null) {
            allNull = false;
            break;
        }
    }
    if (allNull) {
        const subListPath = `${parentPath}.${prop}`;
        const noun = nested.length === 1 ? "action" : "actions";
        out.push(makeLine({
            id: `${subListPath}:placeholder`,
            actionPath: subListPath,
            text: `${indent(depth)}...${nested.length} ${noun}...`,
            depth,
            lineNum: 0,
            italic: true,
            isPlaceholder: true,
        }));
        return;
    }
    appendActions(out, nested, `${parentPath}.${prop}`, depth);
}

function makePlaceholderSlot(
    parentDotted: string,
    idx: number,
    depth: number,
    actionPath: string
): PreviewLine {
    return makeLine({
        id: `${parentDotted}:slot${idx}:placeholder`,
        actionPath,
        text: `${indent(depth)}...`,
        depth,
        lineNum: 0,
        italic: true,
        isPlaceholder: true,
    });
}

function formatConditionsHead(action: { matchAny: boolean; conditions: ReadonlyArray<unknown> | null | undefined }): string {
    const conds = action.conditions;
    const mode = action.matchAny ? "or " : "";
    if (conds === null || conds === undefined) {
        return `${mode}(...conditions...)`;
    }
    if (conds.length === 0) return `${mode}()`;
    const parts: string[] = [];
    let allKnown = true;
    for (let i = 0; i < conds.length; i++) {
        const c = conds[i];
        if (c === null || c === undefined) {
            allKnown = false;
            break;
        }
        let printed: string;
        try {
            // Catch is intentional: conditions read from housing stream in
            // field-by-field, so a partially-hydrated condition can fail
            // printCondition on missing required fields. The catch handles
            // that transient state; a hydration tick fires another snapshot.
            printed = htsw.htsl.printCondition(c as never);
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

function printActionOneLine(action: MaybeAction): string {
    let text: string;
    try {
        // Same partial-hydration catch as formatConditionsHead.
        text = htsw.htsl.printAction(action);
    } catch (_e) {
        return `${action.type.toLowerCase()} ...`;
    }
    const split = text.split("\n");
    return split.length > 0 ? split[0] : text;
}

function makeLine(opts: {
    id: string;
    actionPath?: string;
    text: string;
    depth: number;
    lineNum?: number;
    italic?: boolean;
    isPlaceholder?: boolean;
    isGhost?: boolean;
    diffState?: DiffState;
    completed?: boolean;
}): PreviewLine {
    return {
        id: opts.id,
        actionPath: opts.actionPath,
        tokens: tokenizeHtsl(opts.text),
        depth: opts.depth,
        lineNum: opts.lineNum ?? 0,
        italic: opts.italic,
        isPlaceholder: opts.isPlaceholder,
        isGhost: opts.isGhost,
        diffState: opts.diffState,
        completed: opts.completed,
    };
}

function renumberLines(lines: PreviewLine[]): void {
    let n = 1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].isGhost === true || lines[i].isPlaceholder === true) {
            lines[i].lineNum = 0;
            continue;
        }
        lines[i].lineNum = n;
        n++;
    }
}
