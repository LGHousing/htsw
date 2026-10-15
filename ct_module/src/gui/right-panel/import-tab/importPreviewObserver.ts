import type { Importable } from "htsw/types";
import type { ImportablesParseResult } from "htsw";
import type {
    DiffOpKind,
    SyncEventHandler,
    SyncEvent,
} from "../../../housingSync/syncEvents";
import { queueRowKey } from "../../../housingSync/progress/queueRowKey";
import { importableIdentity } from "../../../importables/identity";
import { importableSourcePath } from "../../../runtime/parsing/importablePaths";
import { invalidateSourceDiffForImportable } from "../../code-view/sourceDiff";
import { ActionPath } from "../../../housingSync/actionPath";
import { setFocusPath } from "./focusedLine";
import { createImportPreviewReplay } from "./importPreviewReplay";
import {
    activatePreview,
    applyComplete,
    finalizeFromSource,
    markHeadApplied,
    markMatch,
    markPreviewCompleted,
    markPlannedAdd,
    markPlannedDelete,
    markPlannedEdit,
    markPlannedMove,
    primeWithCache,
    rebaseToDesired,
    resetPreview,
    setCurrent,
    setCurrentOperation,
    setLiveSummary,
    setObservedTopLevel,
} from "./livePreview";

const BODY_LIST_PROPS: Record<string, true | undefined> = {
    ifActions: true,
    elseActions: true,
    actions: true,
};

// True when an edit touches the action's head line. A CONDITIONAL/RANDOM whose
// only changed fields are child action lists (ifActions/elseActions/actions)
// leaves its head — `if (conditions) {` / `random {` — unchanged; those body
// ops mark their own lines, so flagging the head would falsely show the
// conditions as changed. An empty list (note-only edit) keeps the head marked.
function editAffectsHeadLine(fieldsChanged: readonly string[]): boolean {
    if (fieldsChanged.length === 0) return true;
    for (let i = 0; i < fieldsChanged.length; i++) {
        if (!BODY_LIST_PROPS[fieldsChanged[i]]) return true;
    }
    return false;
}

export function createImportPreviewObserver(args: {
    parsed: ImportablesParseResult;
    sessionSourcePath: string;
    trustMode: boolean;
    housingUuid: string;
}): SyncEventHandler {
    let activeViewPath: string | null = null;

    // Precompute key → importable so importableStarted handler is O(1).
    const importablesByKey = new Map<string, Importable>();
    for (const imp of args.parsed.value) {
        importablesByKey.set(
            queueRowKey(imp.type, importableIdentity(imp), args.sessionSourcePath),
            imp
        );
    }
    const previewReplay = createImportPreviewReplay(args.trustMode);
    let activeViewKey: string | null = null;
    const operationStack: Array<{ path: ActionPath; op: DiffOpKind }> = [];
    const restoreParentOperation = (): boolean => {
        if (activeViewPath === null || operationStack.length === 0) return false;
        const parent = operationStack[operationStack.length - 1];
        setCurrentOperation(activeViewPath, parent.path, parent.op);
        setFocusPath(activeViewPath, parent.path);
        return true;
    };

    // Mapped type: one handler per event kind, parameter narrowed to the
    // specific event shape. TS enforces exhaustiveness — a new kind on the
    // union surfaces here as a typecheck error.
    type Handlers = {
        [E in SyncEvent as E["kind"]]: (event: E) => void;
    };
    const handlers: Handlers = {
        sessionStarted: () => {},
        importableStarted: (e) => {
            operationStack.length = 0;
            const imp = importablesByKey.get(e.key) ?? null;
            activeViewKey = e.key;
            activeViewPath = imp === null ? null : (importableSourcePath(imp) ?? null);
            if (activeViewPath !== null) {
                activatePreview(activeViewPath);
                resetPreview(activeViewPath);
                primeWithCache(activeViewPath, e.cached, { shellOnly: !args.trustMode });
            }
            previewReplay.start(e.key, activeViewPath, e.cached);
        },
        importableFinished: (e) => {
            const imp = importablesByKey.get(e.key);
            if (imp === undefined) return;
            const sourcePath = importableSourcePath(imp);
            if (sourcePath !== undefined && e.status !== "failed") {
                markPreviewCompleted(sourcePath);
            }
            if (e.status === "imported") invalidateSourceDiffForImportable(imp);
        },
        importableReactivated: (e) => {
            operationStack.length = 0;
            const imp = importablesByKey.get(e.key) ?? null;
            activeViewKey = e.key;
            activeViewPath = imp === null ? null : (importableSourcePath(imp) ?? null);
            if (activeViewPath !== null) activatePreview(activeViewPath);
            previewReplay.restore(e.key, activeViewPath);
        },
        importableScanCompleted: () => {},
        importableHydrationCompleted: () => {},
        sessionTotalsLocked: () => {},
        sessionApplicationProgress: () => {},
        applicationProgress: () => {},
        sessionFinished: () => {
            operationStack.length = 0;
            activeViewKey = null;
            activeViewPath = null;
        },
        progress: () => {},
        knowledgeSourceUsed: () => {},
        // Slot focus lives on the progress snapshot (set by the reducer); the
        // panel reads it from there. Nothing to mirror into the code view.
        menuSlotStarted: () => {},
        setupStep: () => {},
        readStarted: (e) => {
            if (activeViewPath === null || e.listPath.parts.length !== 0) return;
            if (activeViewKey !== null) {
                previewReplay.beginRead(activeViewKey, activeViewPath);
            }
        },
        childListReadStarted: (e) => {
            if (activeViewPath === null) return;
            setCurrent(activeViewPath, e.path);
            setFocusPath(activeViewPath, e.path);
        },
        diffPlanned: (e) => {
            if (activeViewPath === null) return;
            setLiveSummary(activeViewPath, e.summary);
            if (e.operations.length > 0) {
                rebaseToDesired(
                    activeViewPath,
                    ActionPath.containingList(e.operations[0].path),
                    e.operations,
                    e.matches
                );
            } else if (e.matches.length > 0) {
                rebaseToDesired(
                    activeViewPath,
                    ActionPath.containingList(e.matches[0]),
                    e.operations,
                    e.matches
                );
            }
            for (const op of e.operations) {
                if (op.op === "delete") {
                    if (op.observed !== null) {
                        markPlannedDelete(activeViewPath, op.path);
                    }
                    continue;
                }
                if (op.op === "edit" && !editAffectsHeadLine(op.fieldsChanged)) {
                    markMatch(activeViewPath, op.path);
                    continue;
                }
                if (op.op === "add") {
                    markPlannedAdd(activeViewPath, op.path, op.desired, op.toIndex);
                } else if (op.op === "edit") {
                    markPlannedEdit(activeViewPath, op.path, op.observed, op.desired);
                } else {
                    markPlannedMove(activeViewPath, op.path, op.fromIndex, op.toIndex);
                }
            }
            for (const p of e.matches) markMatch(activeViewPath, p);
        },
        operationStarted: (e) => {
            if (activeViewPath === null) return;
            operationStack.push({ path: e.path, op: e.op });
            setCurrentOperation(activeViewPath, e.path, e.op);
            if (e.op === "edit" && !editAffectsHeadLine(e.fieldsChanged)) {
                markMatch(activeViewPath, e.path);
            }
            setFocusPath(activeViewPath, e.path);
        },
        operationCompleted: (e) => {
            if (activeViewPath === null) return;
            applyComplete(activeViewPath, e.path, e.finalState, e.op);
            operationStack.pop();
            if (!restoreParentOperation()) setCurrent(activeViewPath, null);
        },
        listSyncCompleted: () => {
            if (activeViewPath === null) return;
            if (restoreParentOperation()) return;
            setCurrent(activeViewPath, null);
            setFocusPath(activeViewPath, null);
        },
        observedSnapshot: (e) => {
            if (activeViewKey !== null) previewReplay.observe(activeViewKey, e.nodes);
            if (activeViewPath !== null) setObservedTopLevel(activeViewPath, e.nodes);
        },
        actionReadCompleted: () => {},
        blockActionHeaderApplied: (e) => {
            if (activeViewPath !== null) markHeadApplied(activeViewPath, e.path);
        },
        finalizeSource: (e) => {
            if (activeViewPath !== null) finalizeFromSource(activeViewPath, e.actions);
        },
    };

    return {
        emit(event) {
            (handlers[event.kind] as (e: typeof event) => void)(event);
        },
    };
}
