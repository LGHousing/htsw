import {
    HTSW_EVENT_CAPACITY,
    HTSW_BRIDGE_VERSION,
    type HtswBridgeEvent,
    type HtswBridgeEventType,
    type HtswBridgeSnapshot,
    type HtswOperation,
    type HtswPrompt,
    type HtswRunStatus,
    type HtswStatusResult,
} from "./types";

const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
let nextRun = 0;
let nextSession = 0;
let sequence = 0;
let run: HtswRunStatus | null = null;
const events: HtswBridgeEvent[] = [];
let write: ((json: string) => void) | null = null;
let sample: (() => Partial<HtswRunStatus>) | null = null;
let conflictDetails: Pick<HtswPrompt, "conflicts" | "diffPath"> = {};
let hadSessionResult = false;

function newRun(operation: HtswOperation, scope: HtswRunStatus["scope"]): HtswRunStatus {
    return {
        runId: `${generation}:${++nextRun}`,
        sessionId: null,
        operation,
        scope,
        state: "running",
        phase: "starting",
        startedAt: Date.now(),
        finishedAt: null,
        currentImportable: null,
        progressFraction: null,
        elapsedMs: 0,
        etaSeconds: null,
        estimatedFinishAt: null,
        estimateState: "unavailable",
        estimateScope: "session",
        prompt: null,
    };
}

export function activeBridgeRunId(): string | null {
    return run !== null && run.finishedAt === null ? run.runId : null;
}

export function bridgeSnapshot(): HtswBridgeSnapshot {
    const now = Date.now();
    if (run !== null && run.finishedAt === null) {
        if (run.state === "running" && run.sessionId !== null)
            Object.assign(run, sample?.());
        run.elapsedMs = Math.max(0, now - run.startedAt);
    }
    return { version: HTSW_BRIDGE_VERSION, generation, updatedAt: now, run, events };
}

export function publishBridgeStatus(): void {
    if (write !== null) write(JSON.stringify(bridgeSnapshot()));
}

export function bridgeStatus(): HtswStatusResult {
    const snapshot = bridgeSnapshot();
    return { available: true, generation, updatedAt: snapshot.updatedAt, run };
}

export function connectBridge(
    writer: (json: string) => void,
    sampler: () => Partial<HtswRunStatus>
): void {
    write = writer;
    sample = sampler;
    publishBridgeStatus();
}

export function disconnectBridge(): void {
    write = null;
    sample = null;
}

export function emitBridgeEvent(
    type: HtswBridgeEventType,
    data: Record<string, unknown>,
    runId: string = (type === "htsw_setting" || type === "htsw_cache_report"
        ? null
        : activeBridgeRunId()) ?? `${generation}:${++nextRun}`
): void {
    const active = run?.runId === runId ? run : null;
    // Freeze event payloads: later progress, prompts and new runs must not alter history.
    events.push(
        JSON.parse(
            JSON.stringify({
                sequence: ++sequence,
                at: Date.now(),
                type,
                data: {
                    runId,
                    sessionId: active?.sessionId ?? null,
                    op: active?.operation,
                    ...data,
                },
            })
        ) as HtswBridgeEvent
    );
    if (events.length > HTSW_EVENT_CAPACITY) events.shift();
    publishBridgeStatus();
}

function emitRun(
    phase: string,
    status: string,
    data: Record<string, unknown> = {}
): void {
    const snapshot = bridgeSnapshot();
    if (snapshot.run === null) return;
    emitBridgeEvent(
        "htsw_run",
        { scope: "run", phase, status, ...data, run: snapshot.run },
        snapshot.run.runId
    );
}

export function beginBridgeRun(
    operation: HtswOperation,
    scope: HtswRunStatus["scope"]
): void {
    run = newRun(operation, scope);
    hadSessionResult = false;
    conflictDetails = {};
    emitRun("started", "running");
}

export function rejectBridgeRun(
    operation: HtswOperation,
    reason: string,
    diagnostic?: HtswBridgeEventType
): void {
    const rejected = newRun(operation, "task");
    rejected.state = "failed";
    rejected.reason = reason;
    rejected.phase = "rejected";
    rejected.finishedAt = Date.now();
    const data = {
        scope: "run",
        phase: "rejected",
        status: "rejected",
        op: operation,
        reason,
    };
    emitBridgeEvent("htsw_session", data, rejected.runId);
    if (diagnostic !== undefined)
        emitBridgeEvent(
            diagnostic,
            { status: "failed", reason, op: operation },
            rejected.runId
        );
    emitBridgeEvent("htsw_run", { ...data, run: rejected }, rejected.runId);
}

export function setBridgeOperation(operation: HtswOperation): void {
    if (run === null || run.finishedAt !== null) return;
    run.operation = operation;
    publishBridgeStatus();
}

export function beginBridgeSession(operation: HtswOperation): void {
    if (run === null || run.finishedAt !== null) return;
    run.operation = operation;
    run.sessionId = `${run.runId}:s${++nextSession}`;
    conflictDetails = {};
    emitBridgeEvent("htsw_session", {
        scope: "session",
        phase: "started",
        status: "running",
    });
}

export function finishBridgeSession(
    status: string,
    data: Record<string, unknown> = {}
): void {
    if (run === null || run.finishedAt !== null || run.sessionId === null) return;
    emitBridgeEvent("htsw_session", {
        scope: "session",
        phase: "finished",
        status,
        ...data,
    });
    hadSessionResult = true;
    run.sessionId = null;
    run.currentImportable = null;
    run.etaSeconds = null;
    run.estimatedFinishAt = null;
    run.estimateState = "unavailable";
    run.phase = "preparing";
    publishBridgeStatus();
}

export function finishBridgeRun(
    state: "completed" | "failed" | "cancelled" | "paused",
    data: Pick<HtswRunStatus, "reason" | "completed" | "failed" | "queued"> = {}
): void {
    if (run === null || run.finishedAt !== null) return;
    bridgeSnapshot();
    finishBridgeSession(state);
    run.state = state;
    Object.assign(run, data);
    run.phase = "finished";
    run.finishedAt = Date.now();
    run.elapsedMs = Math.max(0, run.finishedAt - run.startedAt);
    run.currentImportable = null;
    run.prompt = null;
    run.etaSeconds = null;
    run.estimatedFinishAt = null;
    run.estimateState = "unavailable";
    if (state === "completed") run.progressFraction = 1;
    if (!hadSessionResult)
        emitBridgeEvent(
            "htsw_session",
            {
                scope: run.scope === "queue" ? "queue" : "run",
                phase: "finished",
                status: state,
                ...data,
            },
            run.runId
        );
    emitRun("finished", state, data);
}

export function setBridgeConflictDetails(
    details: Pick<HtswPrompt, "conflicts" | "diffPath">
): void {
    conflictDetails = details;
}

export function openBridgePrompt(prompt: HtswPrompt): void {
    if (run === null || run.finishedAt !== null) return;
    run.state = "waiting_for_input";
    run.phase = "waiting_for_input";
    run.prompt = { ...conflictDetails, ...prompt };
    run.etaSeconds = null;
    run.estimatedFinishAt = null;
    run.estimateState = "unavailable";
    emitBridgeEvent("htsw_session", {
        scope: "run",
        phase: "waiting_for_input",
        status: "awaiting_confirmation",
        ...run.prompt,
    });
    emitRun("waiting_for_input", "awaiting_confirmation", { ...run.prompt });
}

export function closeBridgePrompt(promptId: string): void {
    if (run?.prompt?.promptId !== promptId) return;
    run.prompt = null;
    run.state = "running";
    run.phase = "resuming";
    conflictDetails = {};
    emitRun("resumed", "running");
}
