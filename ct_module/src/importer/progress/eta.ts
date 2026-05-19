import type { ImportProgress, ProgressPhase } from "./types";

const MS_PER_UNIT_PRIOR = 150;

function effectiveMsPerUnit(progress: ImportProgress, elapsedMs: number): number {
    if (progress.completedUnits <= 0 || elapsedMs <= 0) {
        return MS_PER_UNIT_PRIOR;
    }
    const observed = elapsedMs / progress.completedUnits;
    return Math.max(MS_PER_UNIT_PRIOR, observed);
}

function phaseRemainingUnits(progress: ImportProgress, phase: ProgressPhase): number {
    const current = progress.current;
    if (current === null) return 0;
    const phaseStart =
        phase === "reading"
            ? 0
            : phase === "hydrating"
              ? current.phaseUnits.reading
              : current.phaseUnits.reading + current.phaseUnits.hydrating;
    const phaseLength = current.phaseUnits[phase];
    const phaseEnd = phaseStart + phaseLength;
    const within = current.completedUnits;
    if (within >= phaseEnd) return 0;
    if (within <= phaseStart) return phaseLength;
    return Math.max(0, phaseEnd - within);
}

function recompute(progress: ImportProgress, msPerUnit: number): number | null {
    const remainingUnits = Math.max(0, progress.totalUnits - progress.completedUnits);
    if (!isFinite(remainingUnits)) return null;
    return (remainingUnits * msPerUnit) / 1000;
}

let cachedEtaSeconds: number | null = null;
let cachedEtaComputedAt: number | null = null;
let cachedPhaseEtaSeconds: number | null = null;
let cachedPhaseEtaComputedAt: number | null = null;
let cachedPhaseEtaPhase: ProgressPhase | null = null;

export function resetEtaCache(): void {
    cachedEtaSeconds = null;
    cachedEtaComputedAt = null;
    cachedPhaseEtaSeconds = null;
    cachedPhaseEtaComputedAt = null;
    cachedPhaseEtaPhase = null;
}

export function getImportEtaSeconds(
    progress: ImportProgress | null,
    importStartedAt: number | null
): number | null {
    if (progress === null) return null;
    if (cachedEtaSeconds === null || cachedEtaComputedAt === null) {
        cachedEtaSeconds = takeSnapshot(progress, importStartedAt);
        cachedEtaComputedAt = Date.now();
        if (cachedEtaSeconds === null) return null;
    }
    const elapsed = (Date.now() - cachedEtaComputedAt) / 1000;
    return Math.max(0, cachedEtaSeconds - elapsed);
}

function takeSnapshot(
    progress: ImportProgress,
    importStartedAt: number | null
): number | null {
    const elapsedMs =
        importStartedAt === null ? 0 : Math.max(0, Date.now() - importStartedAt);
    const msPerUnit = effectiveMsPerUnit(progress, elapsedMs);
    return recompute(progress, msPerUnit);
}

export function getCurrentPhaseEtaSecondsCached(
    progress: ImportProgress | null,
    importStartedAt: number | null
): number | null {
    if (progress === null || progress.current === null) return null;
    const phase = progress.current.phase;
    if (phase === "done") return null;
    if (
        cachedPhaseEtaSeconds === null ||
        cachedPhaseEtaComputedAt === null ||
        cachedPhaseEtaPhase !== phase
    ) {
        const elapsedMs =
            importStartedAt === null ? 0 : Math.max(0, Date.now() - importStartedAt);
        const msPerUnit = effectiveMsPerUnit(progress, elapsedMs);
        cachedPhaseEtaSeconds = (phaseRemainingUnits(progress, phase) * msPerUnit) / 1000;
        cachedPhaseEtaComputedAt = Date.now();
        cachedPhaseEtaPhase = phase;
    }
    const elapsed = (Date.now() - cachedPhaseEtaComputedAt) / 1000;
    return Math.max(0, cachedPhaseEtaSeconds - elapsed);
}
