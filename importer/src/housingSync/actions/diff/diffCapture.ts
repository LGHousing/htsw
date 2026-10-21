import type { Action } from "htsw/types";

import { createJsonlTrace } from "../../../trace/jsonl";
import type { CurrentActionListEntry } from "./types";

const diffCapture = createJsonlTrace("./htsw/import-diff-capture.jsonl");

export function setDiffCaptureEnabled(enabled: boolean): string {
    return enabled ? diffCapture.start() : diffCapture.stop();
}

export function isDiffCaptureEnabled(): boolean {
    return diffCapture.isEnabled();
}

export function getDiffCapturePath(): string {
    return diffCapture.path();
}

export function captureDiffInput(
    label: string,
    current: CurrentActionListEntry[],
    desired: Action[],
    hadItemDiff: boolean,
    planningPath: "hydrated" | "known",
    trustMode: boolean
): void {
    diffCapture.write({
        kind: "diffInput",
        label,
        current,
        desired,
        hadItemDiff,
        planningPath,
        trustMode,
    });
}
