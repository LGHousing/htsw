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
import { normalizeSoundKey } from "../../importer/fields/sounds";
import type { TokenSpan, FieldSpan } from "../code-view/types";
import type { DiffState, DiffLineInfo } from "./diff";
import type {
    ActionPath,
    DiffFinalState,
    DiffOpKind,
    DiffSummary,
} from "../../importer/importEvents";
import { tokenizeHtsl } from "../right-panel/syntax";
import { normalizeHtswPath } from "../lib/pathDisplay";

type MaybeAction = Action;
type MaybeNestedActions = ReadonlyArray<Action | null>;

/**
 * Which structural variant a `PreviewLine` represents.
 *
 *   "body"         — the primary rendered line for an action
 *   "else"         — `} else {` between a CONDITIONAL's if/else bodies
 *   "close"        — the `}` closing brace of a CONDITIONAL/RANDOM
 *   "ghost"        — gold preview-of-desired below an editing body line
 *   "placeholder"  — `...N actions...` stand-in for a nested list not yet hydrated
 */
export type PreviewVariant = "body" | "else" | "close" | "ghost" | "placeholder";

export type PreviewLine = {
    id: string;
    variant: PreviewVariant;
    actionPath?: string;
    /**
     * True while this line is a preview of state that hasn't been
     * committed yet (a pending-add inserted ahead of its apply, or the
     * ghost preview of an edit). Cleared on `applyComplete` /
     * `markHeadApplied`. The id encodes this — pending lines get a
     * `pending:` prefix so they don't collide with a same-path
     * pending-delete line still in the array.
     */
    pending?: boolean;
    tokens: TokenSpan[];
    fieldSpans?: readonly FieldSpan[];
    depth: number;
    lineNum: number;
    italic?: boolean;
    diffState?: DiffState;
    completed?: boolean;
};

export type LiveOverlay = {
    states: Map<ActionPath, DiffState>;
    details: Map<ActionPath, DiffLineInfo>;
    summary: DiffSummary | null;
    currentPath: ActionPath | null;
    currentLabel: string;
};

type FileState = {
    lines: PreviewLine[];
    revision: number;
    hasContent: boolean;
    overlay: LiveOverlay;
};

function emptyOverlay(): LiveOverlay {
    return {
        states: new Map(),
        details: new Map(),
        summary: null,
        currentPath: null,
        currentLabel: "",
    };
}

const states: { [key: string]: FileState } = {};

function keyForFile(path: string): string {
    return normalizeHtswPath(path);
}

function ensure(path: string): FileState {
    const k = keyForFile(path);
    let s = states[k];
    if (!s) {
        s = { lines: [], revision: 0, hasContent: false, overlay: emptyOverlay() };
        states[k] = s;
    }
    return s;
}

export function getLiveOverlay(path: string): LiveOverlay | undefined {
    return states[keyForFile(path)]?.overlay;
}

// ── Overlay mutators (formerly state/diff.ts) ────────────────────────

export function setLiveState(
    path: string,
    actionPath: ActionPath,
    state: DiffState
): void {
    const o = ensure(path).overlay;
    o.states.set(actionPath, state);
    const existing = o.details.get(actionPath);
    o.details.set(actionPath, { ...(existing ?? { state }), state });
}

export function setLiveSummary(path: string, summary: DiffSummary): void {
    ensure(path).overlay.summary = summary;
}

export function setPlannedOp(
    path: string,
    actionPath: ActionPath,
    kind: DiffOpKind,
    label: string,
    detail: string
): void {
    const o = ensure(path).overlay;
    const state: DiffState =
        kind === "edit" ? "edit" : kind === "add" ? "add" : kind === "move" ? "edit" : "delete";
    const existing = o.details.get(actionPath);
    o.states.set(actionPath, state);
    o.details.set(actionPath, {
        state,
        kind,
        label: label.length > 0 ? label : existing?.label,
        detail: detail.length > 0 ? detail : existing?.detail,
    });
}

export function markLiveCompleted(path: string, actionPath: ActionPath): void {
    const o = ensure(path).overlay;
    const existing = o.details.get(actionPath);
    if (existing === undefined) return;
    o.details.set(actionPath, { ...existing, completed: true });
}

export function setLiveCurrent(
    path: string,
    actionPath: ActionPath | null,
    label: string = ""
): void {
    const o = ensure(path).overlay;
    o.currentPath = actionPath;
    o.currentLabel = label;
}

export function clearLiveOverlay(path: string): void {
    const k = keyForFile(path);
    const s = states[k];
    if (s !== undefined) s.overlay = emptyOverlay();
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

const PENDING_PREFIX = "pending:";

/**
 * Derive a line's stable lookup id from its structural fields. Always
 * call this when setting `line.id` (constructors, mutations) so the id
 * stays consistent with `pending` / `actionPath` / `variant`.
 */
function computeLineId(line: {
    actionPath?: string;
    variant: PreviewVariant;
    pending?: boolean;
}): string {
    const base = `${line.actionPath ?? "?"}:${line.variant}`;
    return line.pending === true ? `${PENDING_PREFIX}${base}` : base;
}

/** Flip the `pending` flag and recompute the line's id. */
function setPending(line: PreviewLine, pending: boolean): void {
    line.pending = pending;
    line.id = computeLineId(line);
}

function markLinesPending(lines: PreviewLine[]): void {
    for (let i = 0; i < lines.length; i++) setPending(lines[i], true);
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
    for (let i = 0; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (line.pending === true && line.actionPath === actionPath && line.variant === "body") {
            return;
        }
    }
    const insertAt = insertionIndexForPath(s.lines, actionPath);
    const depth = depthForActionPath(actionPath);
    const newLines: PreviewLine[] = [];
    appendActionLines(newLines, desired, actionPath, depth);
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
        variant: "ghost",
        actionPath,
        text: ghostText,
        depth,
        italic: true,
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
        // Find every pending line whose actionPath is this one OR a child
        // (nested under "actionPath.") — match by structural identity, not
        // by id-string parsing.
        const childPrefix = `${actionPath}.`;
        let firstAdded = -1;
        let lastAdded = -1;
        for (let i = 0; i < s.lines.length; i++) {
            const line = s.lines[i];
            if (line.actionPath === undefined) continue;
            const isOwnOrChild =
                line.actionPath === actionPath ||
                line.actionPath.indexOf(childPrefix) === 0;
            if (!isOwnOrChild) continue;
            if (line.pending !== true) continue;
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
        // Bottom-up applyDone fires inner adds before outer adds; inner
        // children already had `pending` cleared on their own pass.
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
 * inner ops. Clears `pending` on those three when present; inner
 * children clear their own.
 */
export function markHeadApplied(path: string, actionPath: string): void {
    const s = ensure(path);
    let bodyIdx = -1;
    for (let i = 0; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (line.actionPath === actionPath && line.variant === "body") {
            bodyIdx = i;
            break;
        }
    }
    if (bodyIdx < 0) return;

    let ghostIdx = -1;
    for (let i = bodyIdx + 1; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (line.actionPath === actionPath && line.variant === "ghost") {
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
        if (line.actionPath !== actionPath) continue;
        if (line.variant !== "else" && line.variant !== "close") continue;
        if (line.pending === true) setPending(line, false);
        line.diffState = undefined;
        line.completed = true;
    }

    renumberLines(s.lines);
    bump(s);
}

export function previewLineIdForPath(path: string, actionPath: string): string {
    const s = states[keyForFile(path)];
    if (s !== undefined) {
        for (let i = 0; i < s.lines.length; i++) {
            const line = s.lines[i];
            if (
                line.actionPath === actionPath &&
                line.variant === "body" &&
                line.pending === true
            ) {
                return line.id;
            }
        }
    }
    return computeLineId({ actionPath, variant: "body" });
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

/**
 * Find a line matching the given actionPath + variant, regardless of
 * whether it's pending or committed. Used to locate insertion anchors
 * when an action could be either a real source line or a pending-add
 * preview at the time of lookup.
 */
function findIndexByPathVariant(
    lines: PreviewLine[],
    actionPath: string,
    variant: PreviewVariant
): number {
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].actionPath === actionPath && lines[i].variant === variant) {
            return i;
        }
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
        // Match observed and pending siblings alike so sequential adds resolve in order.
        const siblingStart = findIndexByPathVariant(lines, siblingPath, "body");
        if (siblingStart >= 0) {
            return findActionEndIndex(lines, siblingPath, siblingStart) + 1;
        }
    }

    if (parts.length >= 3) {
        const parentPath = parts.slice(0, parts.length - 2).join(".");
        const prop = parts[parts.length - 2];
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
            variant: "body",
            actionPath,
            text: headText,
            depth,
        }));
        appendNestedListBody(out, action.ifActions, actionPath, "ifActions", depth + 1);
        if (action.elseActions !== undefined && action.elseActions !== null && action.elseActions.length > 0) {
            const elseText = `${indent(depth)}} else {`;
            out.push(makeLine({
                variant: "else",
                actionPath,
                text: elseText,
                depth,
            }));
            appendNestedListBody(out, action.elseActions, actionPath, "elseActions", depth + 1);
        }
        out.push(makeLine({
            variant: "close",
            actionPath,
            text: `${indent(depth)}}`,
            depth,
        }));
        return;
    }
    if (action.type === "RANDOM") {
        out.push(makeLine({
            variant: "body",
            actionPath,
            text: `${indent(depth)}random {`,
            depth,
        }));
        appendNestedListBody(out, action.actions, actionPath, "actions", depth + 1);
        out.push(makeLine({
            variant: "close",
            actionPath,
            text: `${indent(depth)}}`,
            depth,
        }));
        return;
    }
    out.push(makeLine({
        variant: "body",
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
            variant: "placeholder",
            actionPath: subListPath,
            text: `${indent(depth)}...${nested.length} ${noun}...`,
            depth,
            lineNum: 0,
            italic: true,
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
        variant: "placeholder",
        actionPath,
        text: `${indent(depth)}...`,
        depth,
        lineNum: 0,
        italic: true,
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
        text = htsw.htsl.printAction(normalizeActionForPreview(action));
    } catch (_e) {
        return `${action.type.toLowerCase()} ...`;
    }
    const split = text.split("\n");
    return split.length > 0 ? split[0] : text;
}

function normalizeActionForPreview(action: MaybeAction): MaybeAction {
    if (action.type !== "PLAY_SOUND") return action;
    const normalized = { ...action } as Record<string, unknown>;
    if (typeof normalized.sound === "string") {
        normalized.sound = normalizeSoundKey(normalized.sound) ?? normalized.sound;
    }
    if (typeof normalized.volume === "string") {
        const volume = Number(normalized.volume);
        if (Number.isFinite(volume)) normalized.volume = volume;
    }
    if (typeof normalized.pitch === "string") {
        const pitch = Number(normalized.pitch);
        if (Number.isFinite(pitch)) normalized.pitch = pitch;
    }
    if (typeof normalized.location === "string") {
        if (normalized.location === "Not Set") {
            delete normalized.location;
        } else {
            normalized.location = { type: normalized.location };
        }
    }
    return normalized as MaybeAction;
}

function makeLine(opts: {
    variant: PreviewVariant;
    actionPath?: string;
    text: string;
    depth: number;
    lineNum?: number;
    italic?: boolean;
    diffState?: DiffState;
    completed?: boolean;
    /**
     * Optional explicit id override. Only used for per-slot placeholder
     * lines, where multiple lines share the same actionPath + variant
     * and need unique ids (the slot index goes here). Everywhere else
     * the id is derived from `variant + actionPath` via computeLineId.
     */
    id?: string;
}): PreviewLine {
    return {
        id: opts.id ?? computeLineId({ variant: opts.variant, actionPath: opts.actionPath }),
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
