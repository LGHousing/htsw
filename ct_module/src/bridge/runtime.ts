import {
    getTaskProgress,
    getTaskProgressFraction,
    getTaskEtaSeconds,
    getSessionVerb,
    isEtaEstimating,
    isEtaRough,
} from "../gui/right-panel/import-tab/taskProgress";
import { isTaskTotalEtaReady } from "../housingSync/progress/types";
import { javaType } from "../utils/java";
import { connectBridge, disconnectBridge, publishBridgeStatus } from "./status";
import { HTSW_STATUS_PROPERTY, type HtswRunStatus } from "./types";

export function sampleBridgeProgress(): Partial<HtswRunStatus> {
    const progress = getTaskProgress();
    const estimating =
        isEtaEstimating() ||
        (progress !== null &&
            !isTaskTotalEtaReady(progress, getSessionVerb() === "import"));
    const candidate = progress === null || estimating ? null : getTaskEtaSeconds();
    const etaSeconds =
        candidate !== null && Number.isFinite(candidate) && candidate >= 0
            ? candidate
            : null;
    const active = progress?.active;
    return {
        phase: active?.phase ?? "preparing",
        currentImportable:
            active == null
                ? null
                : { key: active.key, type: active.type, identity: active.identity },
        progressFraction: progress === null ? null : getTaskProgressFraction(),
        etaSeconds,
        estimatedFinishAt:
            etaSeconds === null ? null : Date.now() + Math.round(etaSeconds * 1000),
        estimateState: estimating
            ? "estimating"
            : etaSeconds === null
              ? "unavailable"
              : isEtaRough()
                ? "rough"
                : "ready",
    };
}

export function initStatusBridge(): void {
    const system = javaType("java.lang.System");
    connectBridge((json) => {
        system.setProperty(HTSW_STATUS_PROPERTY, json);
    }, sampleBridgeProgress);
    register("step", publishBridgeStatus).setFps(4);
    register("gameUnload", () => {
        disconnectBridge();
        system.clearProperty(HTSW_STATUS_PROPERTY);
    });
}
