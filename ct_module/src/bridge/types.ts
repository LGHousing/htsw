// Wire contract mirrored in minecraft-mcp/packages/protocol/src/htsw.ts.
/** JSON-only JVM bridge. No shared JavaScript objects across CT modules. */
export const HTSW_STATUS_PROPERTY = "htsw.bridge.status";
export const HTSW_BRIDGE_VERSION = 1;
export const HTSW_EVENT_CAPACITY = 256;

export type HtswOperation = "import" | "export" | "read" | "diff";
type HtswRunState =
    "running" | "waiting_for_input" | "completed" | "failed" | "cancelled" | "paused";
type HtswEstimateState = "estimating" | "rough" | "ready" | "unavailable";
interface HtswConflict {
    type: string;
    identity: string;
    basePath: string;
}
export interface HtswPrompt {
    promptId: string;
    confirmAction: string;
    refuseAction: string;
    answerYesCommand: string;
    answerNoCommand: string;
    conflicts?: HtswConflict[];
    diffPath?: string;
}
export interface HtswRunStatus {
    runId: string;
    /** Changes for each progress session within the invocation. */
    sessionId: string | null;
    /** Current operation; mixed queues may change operation between sessions. */
    operation: HtswOperation;
    scope: "queue" | "task";
    state: HtswRunState;
    reason?: string;
    completed?: number;
    failed?: number;
    queued?: number;
    phase: string;
    startedAt: number;
    finishedAt: number | null;
    currentImportable: { key: string; type: string; identity: string } | null;
    /** Current session's progress and ETA, NOT an estimate of pending queue sessions. */
    progressFraction: number | null;
    elapsedMs: number;
    etaSeconds: number | null;
    estimatedFinishAt: number | null;
    estimateState: HtswEstimateState;
    estimateScope: "session";
    prompt: HtswPrompt | null;
}
export type HtswBridgeEventType =
    | "htsw_run"
    | "htsw_session"
    | "htsw_queue"
    | "htsw_importable"
    | "htsw_diff"
    | "htsw_export"
    | "htsw_raw_import"
    | "htsw_plan"
    | "htsw_cache_report"
    | "htsw_setting";
export interface HtswBridgeEvent {
    sequence: number;
    at: number;
    type: HtswBridgeEventType;
    data: {
        runId: string;
        sessionId?: string | null;
        scope?: "run" | "session" | "queue";
        op?: HtswOperation;
        phase?: string;
        status?: string;
        [key: string]: unknown;
    };
}
export interface HtswBridgeSnapshot {
    version: 1;
    generation: string;
    updatedAt: number;
    /** Active or last finished invocation; null before the first run. */
    run: HtswRunStatus | null;
    events: HtswBridgeEvent[];
}

export interface HtswStatusResult {
    clientId?: string;
    available: boolean;
    reason?: string;
    generation?: string;
    updatedAt?: number;
    run: HtswRunStatus | null;
}
