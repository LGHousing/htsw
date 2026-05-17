import type { ImportProgress, ProgressPhase } from "./types";

const MS_PER_UNIT = 150;

function phaseRemainingUnits(
    progress: ImportProgress,
    phase: ProgressPhase
): number {
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

function currentImportableRemainingUnits(progress: ImportProgress): number {
    const current = progress.current;
    if (current === null) return 0;
    return Math.max(0, current.totalUnits - current.completedUnits);
}

function futureImportableRemainingUnits(progress: ImportProgress): number {
    return Math.max(
        0,
        progress.totalUnits -
            progress.completedUnits -
            currentImportableRemainingUnits(progress)
    );
}

function recompute(progress: ImportProgress): number | null {
    const remainingUnits = Math.max(0, progress.totalUnits - progress.completedUnits);
    if (!isFinite(remainingUnits)) return null;
    return (remainingUnits * MS_PER_UNIT) / 1000;
}

let cachedEtaSeconds: number | null = null;
let cachedEtaComputedAt: number | null = null;

export function resetEtaCache(): void {
    cachedEtaSeconds = null;
    cachedEtaComputedAt = null;
}

export function getImportEtaSeconds(progress: ImportProgress | null): number | null {
    if (progress === null) return null;
    if (cachedEtaSeconds === null || cachedEtaComputedAt === null) {
        cachedEtaSeconds = recompute(progress);
        cachedEtaComputedAt = Date.now();
        if (cachedEtaSeconds === null) return null;
    }
    const elapsed = (Date.now() - cachedEtaComputedAt) / 1000;
    const decayed = Math.max(0, cachedEtaSeconds - elapsed);
    const currentImportableDecayed = Math.max(
        0,
        (currentImportableRemainingUnits(progress) * MS_PER_UNIT) / 1000 - elapsed
    );
    return Math.max(decayed, currentImportableDecayed);
}

export type ImportEtaBreakdown = {
    readSeconds: number;
    hydrateSeconds: number;
    applySeconds: number;
    futureImportableSeconds: number;
    futureImportableCount: number;
};

export function getImportEtaBreakdown(
    progress: ImportProgress | null
): ImportEtaBreakdown | null {
    if (progress === null) return null;
    const futureUnits = futureImportableRemainingUnits(progress);
    return {
        readSeconds: (phaseRemainingUnits(progress, "reading") * MS_PER_UNIT) / 1000,
        hydrateSeconds:
            (phaseRemainingUnits(progress, "hydrating") * MS_PER_UNIT) / 1000,
        applySeconds: (phaseRemainingUnits(progress, "applying") * MS_PER_UNIT) / 1000,
        futureImportableSeconds: (futureUnits * MS_PER_UNIT) / 1000,
        futureImportableCount:
            progress.current === null
                ? 0
                : Math.max(
                      0,
                      progress.totalImportables - progress.completedImportables - 1
                  ),
    };
}
