import type { TaskProgress } from "../../../housingSync/progress/types";
import {
    finishTaskProgress,
    setActiveTaskPath,
    setEtaEstimating,
    setEtaRough,
    setSessionTrustMode,
    setSessionVerb,
    setTaskProgress,
    type FinishedTaskSummary,
    type SessionVerb,
} from "./taskProgress";

export type HousingOperationProgressStart = {
    progress: TaskProgress;
    verb: SessionVerb;
    path: string | null;
    etaRough?: boolean;
    trustMode?: boolean | null;
};

export function startHousingOperationProgress(
    options: HousingOperationProgressStart
): void {
    setTaskProgress(options.progress);
    setSessionVerb(options.verb);
    setEtaRough(options.etaRough === true);
    setSessionTrustMode(options.trustMode ?? null);
    setActiveTaskPath(options.path);
}

export function updateHousingOperationProgress(progress: TaskProgress): void {
    setTaskProgress(progress);
}

export function setHousingOperationProgressPath(path: string | null): void {
    setActiveTaskPath(path);
}

export function setHousingOperationProgressScanning(scanning: boolean): void {
    setEtaEstimating(scanning);
}

export function finishHousingOperationProgress(
    failure: string | null,
    summary: FinishedTaskSummary | null = null
): void {
    setActiveTaskPath(null);
    finishTaskProgress(failure, summary);
}

export function clearHousingOperationProgress(): void {
    setActiveTaskPath(null);
    setTaskProgress(null);
}
