/// <reference types="../../../CTAutocomplete" />

/**
 * Mutable per-importable preview model used by the Import tab's live
 * file view.
 *
 * The model is built up over time as the importer reads housing state
 * and applies the diff. The `livePreviewBody` reads `previewLinesForFile`
 * each frame to get the current set of lines to render.
 *
 * Lifecycle of an import:
 *
 *   1. `primeWithCache(path, importable)` — if the HTSW knowledge cache
 *      has the importable, render its actions as gray placeholder lines.
 *      Otherwise the model starts empty.
 *   2. `setObservedTopLevel(path, observed)` — fired after `readActionList`
 *      finishes its top-level read. Replaces the line list with the
 *      actual observed top-level actions. Each nested entry that's
 *      still `null` (unhydrated) renders as a `...action...` placeholder
 *      line; once hydrated it expands to its real contents.
 *   3. `setHydratedNested(path, parentPath, prop, actions)` — fired after
 *      `hydrateNestedAction` reads one nested list. Replaces the
 *      placeholder line(s) for that nested list with real action lines.
 *   4. `markPlannedOp(path, kind, ...)` — fired by the diff sink's
 *      `planOp`. Currently a stub — the apply-phase morph is built in a
 *      follow-up.
 *   5. `applyComplete(path, kind)` — fired by the diff sink's
 *      `completeOp`. Currently a stub.
 *
 * Lines have stable `id`s where possible (`<actionPath>:body` for the
 * primary line, `<parentPath>.<prop>:idx<i>:placeholder` for unhydrated
 * nested action slots). The CodeView's autoFollow uses these ids to
 * keep the cursor centred.
 */

import * as htsw from "htsw";
import type { Action, Importable } from "htsw/types";
import type { TokenSpan, FieldSpan } from "../code-view/types";
import type { DiffState } from "./diff";
import type { DiffFinalState, DiffOpKind } from "../../importer/diffSink";
import { tokenizeHtsl } from "../right-panel/syntax";
import { normalizeHtswPath } from "../lib/pathDisplay";

// Same shape as `Observed<Action>` in importer/types.ts but spelled here
// to avoid the GUI layer reaching into importer internals. Nested action
// arrays may contain `null` entries for slots that haven't been hydrated
// yet.
type MaybeAction = Action;
type MaybeNestedActions = ReadonlyArray<Action | null>;

// ── Public types ────────────────────────────────────────────────────────

export type PreviewLine = {
    /** Stable id used by autoFollow + decorator state lookups. */
    id: string;
    /** Action path this line belongs to (e.g., "0", "0.ifActions.1"). */
    actionPath?: string;
    /** Pre-tokenized line content. */
    tokens: TokenSpan[];
    /** Field-span metadata for per-field decoration. */
    fieldSpans?: readonly FieldSpan[];
    /** Indent depth (each level = 4 spaces in the rendered output). */
    depth: number;
    /**
     * 1-based line number for the gutter, or 0 to suppress the line
     * number. Ghost (pending-edit) lines and placeholder lines suppress
     * the gutter to set themselves apart visually.
     */
    lineNum: number;
    /** Italic body text — used for ghost / placeholder lines. */
    italic?: boolean;
    /** "...action..." placeholder for an unhydrated nested slot. */
    isPlaceholder?: boolean;
    /**
     * Future-edit ghost line — sits below the original observed line and
     * shows what the action will look like after the edit. Suppresses its
     * own line number and is rendered italic.
     */
    isGhost?: boolean;
    /** Diff state if any has been planned/applied for this line. */
    diffState?: DiffState;
    /** Whether the diff op for this line has finished. */
    completed?: boolean;
};

// ── State storage ───────────────────────────────────────────────────────

type FileState = {
    lines: PreviewLine[];
    /** Bumps every time the model mutates so callers can detect change. */
    revision: number;
    /** Whether anything has been primed/observed for this path yet. */
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

// ── Public read API ─────────────────────────────────────────────────────

export function previewLinesForFile(path: string): readonly PreviewLine[] {
    const k = keyForFile(path);
    const s = states[k];
    return s ? s.lines : [];
}

export function previewRevisionForFile(path: string): number {
    const k = keyForFile(path);
    const s = states[k];
    return s ? s.revision : 0;
}

export function previewHasContent(path: string): boolean {
    const k = keyForFile(path);
    const s = states[k];
    return s ? s.hasContent : false;
}

// ── Reset ───────────────────────────────────────────────────────────────

export function resetPreview(path: string): void {
    const k = keyForFile(path);
    delete states[k];
}

export function resetAllPreviews(): void {
    for (const k in states) delete states[k];
}

// ── Cache priming + read-phase mutators ─────────────────────────────────

/**
 * Initial gray render from a cached `Importable`. Caller is responsible
 * for fetching the cache entry via `readKnowledge(...)` — this module
 * only consumes the importable. Safe to call before any read events; a
 * subsequent `setObservedTopLevel` will replace the cached state.
 */
export function primeWithCache(path: string, importable: Importable | null): void {
    const s = ensure(path);
    s.lines = importable === null ? [] : linesForImportable(importable);
    s.hasContent = importable !== null;
    bump(s);
}

/**
 * Replace the model with newly-read top-level observed actions. Nested
 * action slots may be `null` (unhydrated) — those render as placeholder
 * lines until a subsequent `setHydratedNested` fills them in.
 */
export function setObservedTopLevel(
    path: string,
    actions: ReadonlyArray<MaybeAction | null>
): void {
    const s = ensure(path);
    s.lines = buildLines(actions, undefined, 0);
    s.hasContent = true;
    bump(s);
}

/**
 * Replace the placeholder line at `parentPath`.`prop`[idx] with the real
 * action lines for that hydrated child. No-op if the parent wasn't a
 * placeholder when this fires (e.g., trust mode skipped hydration).
 *
 * For now: takes the entire hydrated nested list (Array<Action>) and
 * replaces ALL placeholders for `parentPath`.`prop`. A finer-grained
 * per-slot version can come later.
 */
export function setHydratedNested(
    path: string,
    parentPath: string,
    prop: string,
    actions: ReadonlyArray<MaybeAction | null>
): void {
    const s = ensure(path);
    const placeholderPrefix = `${parentPath}.${prop}:slot`;
    // Find the contiguous range of placeholder lines to replace.
    let firstIdx = -1;
    let lastIdx = -1;
    let depth = 0;
    for (let i = 0; i < s.lines.length; i++) {
        const id = s.lines[i].id;
        if (id.indexOf(placeholderPrefix) === 0) {
            if (firstIdx < 0) {
                firstIdx = i;
                depth = s.lines[i].depth;
            }
            lastIdx = i;
        }
    }
    if (firstIdx < 0) return;
    const replacement = buildLines(actions, `${parentPath}.${prop}`, depth);
    s.lines.splice(firstIdx, lastIdx - firstIdx + 1, ...replacement);
    renumberLines(s.lines);
    bump(s);
}

// ── Diff-phase mutators ────────────────────────────────────────────────

/**
 * Insert pending lines for an action that's about to be added. The new
 * lines are inserted at the position the action will end up in the source
 * file (before the existing action at the same path, or after the
 * preceding sibling, or after the parent body if it's the first child).
 *
 * The new line ids carry an `__add::` prefix so they don't collide with
 * any pre-existing observed line at the same actionPath. Concrete
 * scenario: observed had `b` at index 1 (model line id `5.ifActions.1:body`),
 * desired has `d` at index 1; the diff plans both a delete on `b` and
 * an add on `d`, both keyed `5.ifActions.1`. The pending-add line gets
 * id `__add::5.ifActions.1:body` (distinct), and `applyComplete` strips
 * the prefix once the corresponding delete has already been applied
 * (delete → add ordering in `applyActionListDiffInner` guarantees this).
 */
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
    // Skip when a parent planAdd has ALREADY inserted this action as
    // part of its subtree. Concrete dup case: outer planAdd on a
    // CONDITIONAL inserts body + all nested children + close (each with
    // an `__add::` prefix). Then the importer's writer recurses into
    // syncActionList for the inner ifActions, which fires its own
    // planAdd for each child — but those children are already in the
    // model. Without this guard, the inner planAdds would re-insert
    // duplicate lines (the unprefixed-id lookup misses the prefixed
    // line, so the insertion logic falls through and appends at the
    // end of the file, producing both a position and content dup).
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

/**
 * Mark the existing line for an action as being edited and insert a
 * gold ghost line below it showing the desired post-edit content.
 */
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

/**
 * Mark existing line(s) for an action as pending deletion. The path is
 * the OBSERVED action's model path (e.g. `5.ifActions.1` for the line
 * built from observed[1] inside conditional 5). The line(s) stay in
 * the model (gray + red bg) until `applyComplete` removes them.
 */
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

/**
 * Mark a moving action's existing line. v1 just paints the row gold;
 * the actual reorder lands via `applyComplete` (which falls back to
 * `finalizeFromSource` for full correctness when nested children
 * tag along).
 */
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

// ── Apply-phase morph + final reconciliation ───────────────────────────

/**
 * Morph the line(s) for one action after the importer finishes its op.
 * `kind` decides how: add → finalize lines, edit → splice ghost over
 * original, delete → remove lines, move → finalize.
 */
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
            // Remove ghost from later position first to keep startIdx valid,
            // then replace the original line with the promoted ghost.
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
        // Find the contiguous block of pending-add lines for this
        // actionPath. They were inserted with `__add::` prefixed ids
        // so they don't collide with any observed-pending-delete line
        // at the same path. Match the prefix + the actionPath, with
        // either ":" (own body/else/close) or "." (nested children)
        // following so we don't catch unrelated paths sharing a stem.
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
            // Fallback: a non-prefixed line at this path (older code
            // path or a re-fired event). Mark in place.
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
        // Two-pass: first strip prefixes, then dedup. Strip-then-dedup
        // (vs interleaved) keeps the indices stable across the strip
        // pass — defensive splices during strip would shift firstAdded/
        // lastAdded and break the loop bounds.
        for (let i = firstAdded; i <= lastAdded; i++) {
            // Bottom-up applyDone fires inner adds before outer adds.
            // By the time the outer's loop iterates over its subtree,
            // some lines (the already-applied inner children) have
            // ALREADY had their `__add::` prefix stripped. Don't strip
            // again — that would mangle the id by chopping 7 real chars
            // off the front. Mark completed regardless (idempotent).
            const id = s.lines[i].id;
            if (id.indexOf(ADD_ID_PREFIX) === 0) {
                s.lines[i].id = id.substring(ADD_ID_PREFIX.length);
            }
            s.lines[i].diffState = undefined;
            s.lines[i].completed = true;
        }
        // Defensive dedup: if stripping the `__add::` prefix produced
        // a line whose id collides with another existing line, drop
        // the older one. Catches the move+add edge case (matcher emits
        // a MOVE for the observed line at this actionPath AND an ADD
        // for a new desired action at the same source path; without
        // this both end up with id `<path>:body` after stripping and
        // visually duplicate).
        const idCounts: { [id: string]: number[] } = {};
        for (let i = 0; i < s.lines.length; i++) {
            const id = s.lines[i].id;
            if (idCounts[id] === undefined) idCounts[id] = [];
            idCounts[id].push(i);
        }
        // Walk back-to-front so splicing doesn't invalidate earlier indices.
        const dupIdsToRemove: number[] = [];
        for (const id in idCounts) {
            const positions = idCounts[id];
            if (positions.length <= 1) continue;
            // Keep the line we just stripped (or the latest one that's
            // marked completed); remove the others. Heuristic: keep the
            // last position (the just-promoted pending-add tends to be
            // the most recent insertion).
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
 * Mark the head of an action as completed — its body line + (if it's a
 * block-bearing action) the matching `} else {` and `}` lines. Used by
 * `markActionHeadApplied` from the importer: when a CONDITIONAL's
 * conditions and matchAny are written, the head is "correct" even
 * though inner ifActions sync work continues. Without this, those
 * three lines would stay gray-pending until every inner op finished.
 *
 * Strips the `__add::` prefix on body / else / close (when present)
 * since the head is now real, not pending. Inner children keep their
 * own prefix until their individual `applyDone` strips them.
 *
 * If a ghost line exists below the body (planEdit was called), promote
 * it the same way `applyComplete(kind: "edit")` does so the body shows
 * the desired text, not the observed.
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

    // Promote ghost if planEdit had inserted one.
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

    // Mark `} else {` and `}` of this same actionPath as completed too.
    // Strip the `__add::` prefix on either if present.
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

/**
 * Resolve an actionPath to the actual line id present in the model.
 * Pending-add lines carry an `__add::` prefix; without this lookup,
 * autoFollow's `lineIdToIndex[focusedId]` would miss them and the
 * viewport wouldn't recenter on a freshly-added action.
 */
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

/**
 * Final reconciliation: rebuild the line list from the parsed source
 * action tree, all `completed=true`. Catches edge cases the per-op
 * morphs missed — notably synthetic deletes for housing-only actions
 * and deep moves with nested children.
 */
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

// ── Position helpers ───────────────────────────────────────────────────

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

/**
 * Find the model index where a new action with the given source path
 * should be inserted. Tries: (1) before the existing action at this
 * path, (2) after the preceding sibling at index-1, (3) right after the
 * parent's body / else line, (4) end of file.
 *
 * Each "find by id" check considers both the regular id and the
 * `__add::` prefixed variant — the parent might still be a pending-add
 * (e.g. when sibling adds resolve out-of-tree-order).
 */
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
        // Match BOTH unprefixed (existing observed) AND `__add::` prefixed
        // (just-inserted pending) siblings. Without this, sequential adds
        // (Pt2 → Pt3 → Pt4) can't see each other as siblings — each falls
        // through to the parent-body fallback and inserts at parentBody+1,
        // which reverses their visual order.
        const siblingStart = findIndexByIdAny(lines, `${siblingPath}:body`);
        if (siblingStart >= 0) {
            // findActionEndIndex scans by `line.actionPath`, which is the
            // same on prefixed and unprefixed lines, so it correctly walks
            // either kind to the end of its scope.
            return findActionEndIndex(lines, siblingPath, siblingStart) + 1;
        }
    }

    if (parts.length >= 3) {
        const parentPath = parts.slice(0, parts.length - 2).join(".");
        const prop = parts[parts.length - 2];
        if (prop === "elseActions") {
            const elseIdx = findIndexByIdAny(lines, `${parentPath}:else`);
            if (elseIdx >= 0) return elseIdx + 1;
            // No else line yet — insert before the close brace.
            const closeIdx = findIndexByIdAny(lines, `${parentPath}:close`);
            if (closeIdx >= 0) return closeIdx;
        } else {
            const bodyIdx = findIndexByIdAny(lines, `${parentPath}:body`);
            if (bodyIdx >= 0) return bodyIdx + 1;
        }
    }

    return lines.length;
}

// ── Line generation ─────────────────────────────────────────────────────

function linesForImportable(importable: Importable): PreviewLine[] {
    const out: PreviewLine[] = [];
    if (importable.type === "FUNCTION" || importable.type === "EVENT") {
        appendActions(out, importable.actions, undefined, 0);
    } else if (importable.type === "REGION") {
        // For now we render the entry actions only. A future iteration
        // can add a divider header + exit actions.
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
            // Per-slot placeholder (used inside an unhydrated nested
            // body). The `:slotN:placeholder` id lets `setHydratedNested`
            // find the contiguous range to replace.
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
    // Plain (non-nested) action: one line.
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
        return; // empty body — render nothing inside the braces
    }
    // If every entry is null (fully unhydrated), collapse to a single
    // `...N actions...` placeholder line so the user sees the known
    // count rather than N separate `...` slot lines. As soon as ANY
    // entry hydrates, fall through to per-entry rendering (mixed
    // hydrated + still-null is handled by the per-slot fallback).
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
    // Print each condition with the language printer when known. Null
    // entries (unhydrated) and print failures fall back to the
    // `(...conditions...)` placeholder so a partially-hydrated parent
    // still renders a meaningful header.
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

/**
 * Print a single non-nested action onto one line. Falls back to the
 * action type name on any failure (e.g. partially-hydrated observed
 * action with null required fields).
 */
function printActionOneLine(action: MaybeAction): string {
    let text: string;
    try {
        text = htsw.htsl.printAction(action);
    } catch (_e) {
        // The action's scalar fields aren't all populated yet — leave a
        // visible "loading" marker so the user can see something is
        // pending. Hydration will replace this on the next snapshot.
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
            // Ghosts and placeholders never get a line number.
            lines[i].lineNum = 0;
            continue;
        }
        lines[i].lineNum = n;
        n++;
    }
}
