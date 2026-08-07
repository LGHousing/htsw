/// <reference types="../../../../CTAutocomplete" />

import { createJsonlTrace } from "../../../trace/jsonl";
import { atomicWriteText } from "../../../utils/filesystem";
import { javaType, runtimeString, type RuntimeString } from "../../../utils/java";
import { openPathInOS } from "../../../utils/osShell";
import { ActionTreePath } from "../../../housingSync/actionPath";
import { inspectImportCodeView } from "../importCodeView";
import { getTaskProgress } from "./taskProgress";

const TRACE_PATH = "./htsw/import-codeview-trace.jsonl";
const REPLAY_PATH = "./htsw/import-codeview-replay.html";
const VIEWER_TEMPLATE_PATH =
    "./config/ChatTriggers/modules/HTSW/import-codeview-viewer.html";
const SAMPLE_INTERVAL_MS = 50;

const trace = createJsonlTrace(TRACE_PATH);
let lastSampleAt = 0;
let lastModelIdentity = "";
let lastModelJson = "";
let lastFrameJson = "";
let modelId = 0;
let frameCount = 0;

export function startImportCodeViewTrace(): string {
    lastSampleAt = 0;
    lastModelIdentity = "";
    lastModelJson = "";
    lastFrameJson = "";
    modelId = 0;
    frameCount = 0;
    trace.start();
    trace.write({ kind: "meta", schema: 1, sampleIntervalMs: SAMPLE_INTERVAL_MS });
    sampleImportCodeViewTrace(true);
    return TRACE_PATH;
}

export function stopImportCodeViewTrace(): { tracePath: string; replayPath: string } {
    if (trace.isEnabled()) {
        sampleImportCodeViewTrace(true);
        trace.write({ kind: "end", frameCount, modelCount: modelId });
        trace.stop();
    }
    return { tracePath: absolutePath(TRACE_PATH), replayPath: buildImportCodeViewReplay() };
}

export function openImportCodeViewReplay(): string {
    const replayPath = buildImportCodeViewReplay();
    openPathInOS(replayPath);
    return replayPath;
}

export function isImportCodeViewTraceEnabled(): boolean {
    return trace.isEnabled();
}

export function getImportCodeViewTraceStatus(): {
    tracePath: string;
    replayPath: string;
    frames: number;
    models: number;
} {
    return {
        tracePath: absolutePath(TRACE_PATH),
        replayPath: absolutePath(REPLAY_PATH),
        frames: frameCount,
        models: modelId,
    };
}

export function sampleImportCodeViewTrace(force: boolean = false): void {
    if (!trace.isEnabled()) return;
    const now = Date.now();
    if (!force && now - lastSampleAt < SAMPLE_INTERVAL_MS) return;
    lastSampleAt = now;

    try {
        const inspection = inspectImportCodeView();
        const modelIdentity = JSON.stringify({
            visible: inspection.visible,
            path: inspection.path,
            verb: inspection.verb,
            previewRevision: inspection.previewRevision,
            currentPath: inspection.currentPath,
            currentOperation: inspection.currentOperation,
            focusedLineId: inspection.lineDecorator.focusedLineId(),
        });
        let modelChanged = false;
        if (modelIdentity !== lastModelIdentity) {
            lastModelIdentity = modelIdentity;
            const model = captureModel(inspection);
            const modelJson = JSON.stringify(model);
            if (modelJson !== lastModelJson) {
                modelId++;
                lastModelJson = modelJson;
                trace.write({ kind: "model", modelId, state: model });
                modelChanged = true;
            }
        }

        const frame = captureFrame(inspection);
        const frameJson = JSON.stringify(frame);
        if (!modelChanged && frameJson === lastFrameJson) return;
        lastFrameJson = frameJson;
        frameCount++;
        trace.write({ kind: "frame", frame: frameCount, modelId, state: frame });
    } catch (error) {
        trace.write({
            kind: "captureError",
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

function captureModel(inspection: ReturnType<typeof inspectImportCodeView>) {
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < inspection.lines.length; i++) {
        const line = inspection.lines[i];
        const decorations = inspection.lineDecorator.decorateLine(line);
        rows.push({
            id: line.id,
            lineNum: line.lineNum,
            actionPath:
                line.actionPath === undefined ? null : ActionTreePath.key(line.actionPath),
            tokens: line.tokens.map((token) => ({ text: token.text, color: token.color })),
            marker: decorations.marker ?? null,
            foregroundColor: decorations.foregroundColor ?? null,
            background: decorations.background ?? decorations.marker?.background ?? null,
            alpha: decorations.alpha ?? 1,
            caret: decorations.isFocused === true,
            cursorColumnBackground: decorations.cursorColumnBackground ?? null,
            italic: decorations.italic === true,
            hideLineNum: decorations.hideLineNum === true,
            pending: line.pending === true,
            plannedOp: line.plannedOp ?? null,
            completed: line.completed === true,
            deleted: line.deleted === true,
        });
    }
    return {
        visible: inspection.visible,
        path: inspection.path,
        viewIdentity: inspection.viewIdentity,
        verb: inspection.verb,
        emptyMessage: inspection.emptyMessage,
        focusedLineId: inspection.lineDecorator.focusedLineId(),
        currentPath: inspection.currentPath,
        currentOperation: inspection.currentOperation,
        previewRevision: inspection.previewRevision,
        rows,
    };
}

function captureFrame(inspection: ReturnType<typeof inspectImportCodeView>) {
    const progress = getTaskProgress();
    const active = progress?.active ?? null;
    return {
        followRequested: inspection.followRequested,
        progress:
            progress === null
                ? null
                : {
                      completedUnits: progress.completedUnits,
                      totalUnits: progress.totalUnits,
                      totalsLocked: progress.totalsLocked,
                      active:
                          active === null
                              ? null
                              : {
                                    key: active.key,
                                    type: active.type,
                                    identity: active.identity,
                                    phase: active.phase,
                                    completedUnits: active.completedUnits,
                                    totalUnits: active.totalUnits,
                                },
                  },
        scroll: inspection.scroll,
    };
}

function buildImportCodeViewReplay(): string {
    const template = readText(VIEWER_TEMPLATE_PATH);
    if (template.indexOf("window.__HTSW_TRACE__ = null;") < 0) {
        throw new Error("The import CodeView replay template is invalid");
    }
    const rawTrace = readText(TRACE_PATH);
    const embeddedTrace = JSON.stringify(rawTrace).split("<").join("\\u003c");
    const output = template.replace(
        "window.__HTSW_TRACE__ = null;",
        `window.__HTSW_TRACE__ = ${embeddedTrace};`
    );
    if (!atomicWriteText(REPLAY_PATH, output)) {
        throw new Error(`Could not write ${REPLAY_PATH}`);
    }
    return absolutePath(REPLAY_PATH);
}

function readText(path: string): string {
    const value = FileLib.read(path) as RuntimeString | null | undefined;
    if (value === null || value === undefined) throw new Error(`Could not read ${path}`);
    return runtimeString(value);
}

function absolutePath(path: string): string {
    const Paths = javaType("java.nio.file.Paths");
    return String(Paths.get(runtimeString(path)).toAbsolutePath().normalize().toString());
}
