/// <reference types="../../../../CTAutocomplete" />

import * as htsw from "htsw";
import type { Action, Importable } from "htsw/types";
import { normalizeSoundKey } from "../../../housingSync/fields/sounds";
import type { TokenSpan, FieldSpan } from "../../code-view/lineTypes";
import type { DiffState } from "../../code-view/diffPalette";
import type {
    ActionPath,
    DiffFinalState,
    DiffOpKind,
    DiffSummary,
} from "../../../housingSync/syncEvents";
import { actionPathKey } from "../../../housingSync/syncEvents";
import { tokenizeHtsl } from "../syntax";
import { normalizeHtswPath } from "../../lib/pathDisplay";
import { markGuiDirty } from "../../lib/dirty";

type MaybeAction = Action;
type MaybeNestedActions = ReadonlyArray<Action | null>;

type PreviewVariant = "body" | "else" | "close" | "ghost" | "placeholder";

export type PreviewLine = {
    id: string;
    variant: PreviewVariant;
    actionPath?: string;
    pending?: boolean;
    tokens: TokenSpan[];
    fieldSpans?: readonly FieldSpan[];
    depth: number;
    lineNum: number;
    italic?: boolean;
    diffState?: DiffState;
    completed?: boolean;
};

type FileState = {
    lines: PreviewLine[];
    revision: number;
    hasContent: boolean;
    /** Action path the importer is touching right now (cursor / scroll target). */
    currentPath: ActionPath | null;
    /** Set once the diff plan is known; its presence means we're in the apply phase. */
    summary: DiffSummary | null;
    lastObservedAt: number;
};

/**
 * Minimum gap between full observed-snapshot rebuilds for one file. Each
 * rebuild reconstructs the whole line array (new line objects), which
 * invalidates the per-line text-wrap cache and forces a full re-measure on
 * the next frame. During the hydration of a large function the importer
 * emits snapshots in rapid bursts; coalescing them here keeps the rebuild
 * + re-measure cost bounded so the game stays responsive. The final state
 * is never lost — `finalizeFromSource` rebuilds unconditionally at the end.
 */
const OBSERVED_REBUILD_THROTTLE_MS = 200;

const states: { [key: string]: FileState } = {};

function keyForFile(path: string): string {
    return normalizeHtswPath(path);
}

function ensure(path: string): FileState {
    const k = keyForFile(path);
    let s = states[k];
    if (!s) {
        s = { lines: [], revision: 0, hasContent: false, currentPath: null, summary: null, lastObservedAt: 0 };
        states[k] = s;
    }
    return s;
}

function bump(s: FileState): void {
    s.revision = s.revision + 1;
    markGuiDirty();
}

const PENDING_PREFIX = "pending:";

function computeLineId(line: {
    actionPath?: string;
    variant: PreviewVariant;
    pending?: boolean;
}): string {
    const base = `${line.actionPath ?? "?"}:${line.variant}`;
    return line.pending === true ? `${PENDING_PREFIX}${base}` : base;
}

function setPending(line: PreviewLine, pending: boolean): void {
    line.pending = pending;
    line.id = computeLineId(line);
}

function markLinesPending(lines: PreviewLine[]): void {
    for (let i = 0; i < lines.length; i++) setPending(lines[i], true);
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

function linesForImportable(importable: Importable, shellOnly: boolean): PreviewLine[] {
    const out: PreviewLine[] = [];
    if (importable.type === "FUNCTION" || importable.type === "EVENT") {
        appendActions(out, importable.actions ?? [], undefined, 0, shellOnly);
    } else if (importable.type === "REGION") {
        appendActions(out, importable.onEnterActions ?? [], undefined, 0, shellOnly);
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
    appendActions(out, actions, pathPrefix, depth, false);
    renumberLines(out);
    return out;
}

function appendActions(
    out: PreviewLine[],
    actions: ReadonlyArray<MaybeAction | null>,
    pathPrefix: string | undefined,
    depth: number,
    shellOnly: boolean
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
        appendActionLines(out, action, path, depth, shellOnly);
    }
}

function appendActionLines(
    out: PreviewLine[],
    action: MaybeAction,
    actionPath: string,
    depth: number,
    shellOnly: boolean
): void {
    if (action.type === "CONDITIONAL") {
        const condText = shellOnly
            ? `${action.matchAny ? "or " : ""}(...conditions...)`
            : formatConditionsHead(action);
        const headText = `${indent(depth)}if ${condText} {`;
        out.push(makeLine({
            variant: "body",
            actionPath,
            text: headText,
            depth,
        }));
        if (!shellOnly) {
            appendNestedListBody(out, action.ifActions, actionPath, "ifActions", depth + 1, shellOnly);
            if (action.elseActions !== undefined && action.elseActions !== null && action.elseActions.length > 0) {
                const elseText = `${indent(depth)}} else {`;
                out.push(makeLine({
                    variant: "else",
                    actionPath,
                    text: elseText,
                    depth,
                }));
                appendNestedListBody(out, action.elseActions, actionPath, "elseActions", depth + 1, shellOnly);
            }
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
        if (!shellOnly) {
            appendNestedListBody(out, action.actions, actionPath, "actions", depth + 1, shellOnly);
        }
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
    depth: number,
    shellOnly: boolean
): void {
    if (nested === null || nested === undefined || nested.length === 0) {
        return;
    }
    let allNull = true;
    for (let i = 0; i < nested.length; i++) {
        if (nested[i] !== null) {
            allNull = false;
            break;
        }
    }
    if (allNull || shellOnly) {
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
    appendActions(out, nested, `${parentPath}.${prop}`, depth, shellOnly);
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

// ── Exported query / mutation API ───────────────────────────────────

export function previewLinesForFile(path: string): readonly PreviewLine[] {
    const k = keyForFile(path);
    const s = states[k];
    return s ? s.lines : [];
}

export function resetPreview(path: string): void {
    const k = keyForFile(path);
    if (states[k] !== undefined) {
        delete states[k];
        markGuiDirty();
    }
}

export function primeWithCache(
    path: string,
    importable: Importable | null,
    options?: { shellOnly?: boolean }
): void {
    const s = ensure(path);
    const shellOnly = options?.shellOnly === true;
    s.lines = importable === null ? [] : linesForImportable(importable, shellOnly);
    s.hasContent = importable !== null;
    bump(s);
}

export function setObservedTopLevel(
    path: string,
    actions: ReadonlyArray<MaybeAction | null>
): void {
    const s = ensure(path);
    const now = Date.now();
    if (s.hasContent && now - s.lastObservedAt < OBSERVED_REBUILD_THROTTLE_MS) {
        return;
    }
    s.lastObservedAt = now;
    s.lines = buildLines(actions, undefined, 0);
    s.hasContent = true;
    bump(s);
}

export function markPlannedAdd(
    path: string,
    actionPath: ActionPath,
    desired: Action,
    _toIndex: number
): void {
    const s = ensure(path);
    const actionPathKeyValue = actionPathKey(actionPath);
    for (let i = 0; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (line.pending === true && line.actionPath === actionPathKeyValue && line.variant === "body") {
            return;
        }
    }
    const insertAt = insertionIndexForPath(s.lines, actionPathKeyValue);
    const depth = depthForActionPath(actionPathKeyValue);
    const newLines: PreviewLine[] = [];
    appendActionLines(newLines, desired, actionPathKeyValue, depth, false);
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
    const actionPathKeyValue = actionPathKey(actionPath);
    const startIdx = findActionStartIndex(s.lines, actionPathKeyValue);
    if (startIdx < 0) return;
    s.lines[startIdx].diffState = "edit";
    const depth = s.lines[startIdx].depth;
    const ghostText = `${indent(depth)}${printActionOneLine(desired)}`;
    const ghost = makeLine({
        variant: "ghost",
        actionPath: actionPathKeyValue,
        text: ghostText,
        depth,
        italic: true,
        diffState: "edit",
    });
    s.lines.splice(startIdx + 1, 0, ghost);
    renumberLines(s.lines);
    bump(s);
}

export function markPlannedDelete(path: string, actionPath: ActionPath): void {
    const s = ensure(path);
    const actionPathKeyValue = actionPathKey(actionPath);
    const startIdx = findActionStartIndex(s.lines, actionPathKeyValue);
    if (startIdx < 0) return;
    const endIdx = findActionEndIndex(s.lines, actionPathKeyValue, startIdx);
    for (let i = startIdx; i <= endIdx; i++) {
        s.lines[i].diffState = "delete";
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
    const startIdx = findActionStartIndex(s.lines, actionPathKey(actionPath));
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
    const actionPathKeyValue = actionPathKey(actionPath);
    if (kind === "delete") {
        const startIdx = findActionStartIndex(s.lines, actionPathKeyValue);
        if (startIdx < 0) return;
        const endIdx = findActionEndIndex(s.lines, actionPathKeyValue, startIdx);
        s.lines.splice(startIdx, endIdx - startIdx + 1);
        renumberLines(s.lines);
        bump(s);
        return;
    }
    if (kind === "edit") {
        const startIdx = findActionStartIndex(s.lines, actionPathKeyValue);
        if (startIdx < 0) return;
        let ghostIdx = -1;
        const ghostId = `${actionPathKeyValue}:ghost`;
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
        const childPrefix = `${actionPathKeyValue}.`;
        let firstAdded = -1;
        let lastAdded = -1;
        for (let i = 0; i < s.lines.length; i++) {
            const line = s.lines[i];
            if (line.actionPath === undefined) continue;
            const isOwnOrChild =
                line.actionPath === actionPathKeyValue ||
                line.actionPath.indexOf(childPrefix) === 0;
            if (!isOwnOrChild) continue;
            if (line.pending !== true) continue;
            if (firstAdded < 0) firstAdded = i;
            lastAdded = i;
        }
        if (firstAdded < 0) {
            const startIdx = findActionStartIndex(s.lines, actionPathKeyValue);
            if (startIdx < 0) return;
            const endIdx = findActionEndIndex(s.lines, actionPathKeyValue, startIdx);
            for (let i = startIdx; i <= endIdx; i++) {
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
    if (kind === "move") {
        const startIdx = findActionStartIndex(s.lines, actionPathKeyValue);
        if (startIdx < 0) return;
        s.lines[startIdx].diffState = undefined;
        s.lines[startIdx].completed = true;
        bump(s);
        return;
    }
}

export function markHeadApplied(path: string, actionPath: ActionPath): void {
    const s = ensure(path);
    const actionPathKeyValue = actionPathKey(actionPath);
    let bodyIdx = -1;
    for (let i = 0; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (line.actionPath === actionPathKeyValue && line.variant === "body") {
            bodyIdx = i;
            break;
        }
    }
    if (bodyIdx < 0) return;

    let ghostIdx = -1;
    for (let i = bodyIdx + 1; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (line.actionPath === actionPathKeyValue && line.variant === "ghost") {
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
        if (line.actionPath !== actionPathKeyValue) continue;
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
    actionPath: ActionPath
): string | null {
    const s = states[keyForFile(path)];
    if (s === undefined) return null;
    const actionPathKeyValue = actionPathKey(actionPath);
    for (let i = 0; i < s.lines.length; i++) {
        const line = s.lines[i];
        if (
            line.actionPath === actionPathKeyValue &&
            line.variant === "body" &&
            line.pending === true
        ) {
            return actionPathKeyValue;
        }
    }
    let probe = actionPathKeyValue;
    while (probe.length > 0) {
        for (let i = 0; i < s.lines.length; i++) {
            const line = s.lines[i];
            if (line.actionPath === probe && line.variant === "body") {
                return probe;
            }
        }
        const dot = probe.lastIndexOf(".");
        if (dot < 0) break;
        probe = probe.substring(0, dot);
    }
    return null;
}

export function previewLineIdForPath(path: string, actionPath: ActionPath): string {
    const effective = effectiveFocusActionPath(path, actionPath);
    if (effective === null) {
        return computeLineId({ actionPath: actionPathKey(actionPath), variant: "body" });
    }
    const s = states[keyForFile(path)];
    if (s !== undefined) {
        for (let i = 0; i < s.lines.length; i++) {
            const line = s.lines[i];
            if (
                line.actionPath === effective &&
                line.variant === "body" &&
                line.pending === true
            ) {
                return line.id;
            }
        }
        for (let i = 0; i < s.lines.length; i++) {
            const line = s.lines[i];
            if (line.actionPath === effective && line.variant === "body") {
                return line.id;
            }
        }
    }
    return computeLineId({ actionPath: effective, variant: "body" });
}

export function finalizeFromSource(
    path: string,
    actions: ReadonlyArray<Action>
): void {
    const s = ensure(path);
    const out: PreviewLine[] = [];
    appendActions(out, actions, undefined, 0, false);
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

export function getCurrentPath(path: string): ActionPath | null {
    return states[keyForFile(path)]?.currentPath ?? null;
}

export function getLiveSummary(path: string): DiffSummary | null {
    return states[keyForFile(path)]?.summary ?? null;
}

export function setCurrent(path: string, actionPath: ActionPath | null): void {
    const s = ensure(path);
    if (s.currentPath === actionPath) return;
    s.currentPath = actionPath;
    markGuiDirty();
}

export function setLiveSummary(path: string, summary: DiffSummary): void {
    const s = ensure(path);
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
    const actionPathKeyValue = actionPathKey(actionPath);
    let changed = false;
    for (let i = 0; i < s.lines.length; i++) {
        if (s.lines[i].actionPath === actionPathKeyValue) {
            s.lines[i].completed = true;
            s.lines[i].diffState = undefined;
            changed = true;
        }
    }
    if (changed) bump(s);
}
