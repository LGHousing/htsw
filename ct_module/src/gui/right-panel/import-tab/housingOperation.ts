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

export type HousingOperationStart = {
    progress: TaskProgress;
    verb: SessionVerb;
    path: string | null;
    etaRough?: boolean;
    trustMode?: boolean | null;
};

export function startHousingOperation(options: HousingOperationStart): void {
    setTaskProgress(options.progress);
    setSessionVerb(options.verb);
    setEtaRough(options.etaRough === true);
    setSessionTrustMode(options.trustMode ?? null);
    setActiveTaskPath(options.path);
}

export function updateHousingOperation(progress: TaskProgress): void {
    setTaskProgress(progress);
}

export function setHousingOperationPath(path: string | null): void {
    setActiveTaskPath(path);
}

export function setHousingOperationScanning(scanning: boolean): void {
    setEtaEstimating(scanning);
}

export function finishHousingOperation(
    failure: string | null,
    summary: FinishedTaskSummary | null = null
): void {
    setActiveTaskPath(null);
    finishTaskProgress(failure, summary);
}

export function clearHousingOperation(): void {
    setActiveTaskPath(null);
    setTaskProgress(null);
}
