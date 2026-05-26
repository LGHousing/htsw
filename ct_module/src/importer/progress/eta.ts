import type { ImportProgress, ProgressPhase } from "./types";
import { traceEtaSnapshot } from "./trace";
import { getTimingStats } from "./timing";

const MS_PER_UNIT_PRIOR = 150;

type EtaSnapshot = {
    etaSeconds: number;
    computedAt: number;
    phase: ProgressPhase | "done" | null;
    key: string;
    completedUnits: number;
    totalUnits: number;
    remainingUnits: number;
    msPerUnit: number;
};

export type EtaCalculator = {
    getTotal(progress: ImportProgress | null, importStartedAt: number | null): number | null;
    getPhase(progress: ImportProgress | null, importStartedAt: number | null): number | null;
};

export function createEtaCalculator(): EtaCalculator {
    let totalEta: EtaSnapshot | null = null;
    let phaseEta: EtaSnapshot | null = null;

    return {
        getTotal(progress, _importStartedAt) {
            if (progress === null) return null;
            const now = Date.now();
            let recomputed = false;
            if (isTotalStale(totalEta, progress)) {
                const msPerUnit = currentMsPerUnit();
                const remainingUnits = Math.max(
                    0,
                    progress.totalUnits - progress.completedUnits
                );
                totalEta = {
                    etaSeconds: (remainingUnits * msPerUnit) / 1000,
                    computedAt: now,
                    phase: progress.active?.phase ?? null,
                    key: progress.active?.key ?? "",
                    completedUnits: progress.completedUnits,
                    totalUnits: progress.totalUnits,
                    remainingUnits,
                    msPerUnit,
                };
                recomputed = true;
                traceEtaSnapshot({
                    kind: "total",
                    msPerUnit,
                    remainingUnits,
                    etaSeconds: totalEta.etaSeconds,
                    completedUnits: progress.completedUnits,
                    totalUnits: progress.totalUnits,
                    active: progress.active === null
                        ? null
                        : {
                              key: progress.active.key,
                              phase: progress.active.phase,
                              completedUnits: progress.active.completedUnits,
                              totalUnits: progress.active.totalUnits,
                              phaseUnits: progress.active.phaseUnits,
                        },
                });
            }
            const elapsed = (now - totalEta!.computedAt) / 1000;
            const displayedEtaSeconds = Math.max(0, totalEta!.etaSeconds - elapsed);
            traceEtaSnapshot({
                kind: "totalDisplay",
                recomputed,
                displayedEtaSeconds,
                snapshotEtaSeconds: totalEta!.etaSeconds,
                elapsedSinceSnapshotSeconds: elapsed,
                msPerUnit: totalEta!.msPerUnit,
                remainingUnits: totalEta!.remainingUnits,
                completedUnits: progress.completedUnits,
                totalUnits: progress.totalUnits,
                activePhase: progress.active?.phase ?? null,
                activeCompletedUnits: progress.active?.completedUnits ?? null,
                activeTotalUnits: progress.active?.totalUnits ?? null,
                activePhaseUnits: progress.active?.phaseUnits ?? null,
            });
            return displayedEtaSeconds;
        },
        getPhase(progress, _importStartedAt) {
            if (progress === null || progress.active === null) {
                return null;
            }
            const phase = progress.active.phase;
            if (phase === "done") return null;
            const now = Date.now();
            let recomputed = false;
            if (isPhaseStale(phaseEta, progress)) {
                const msPerUnit = currentMsPerUnit();
                const remainingUnits = phaseRemainingUnits(progress, phase);
                phaseEta = {
                    etaSeconds: (remainingUnits * msPerUnit) / 1000,
                    computedAt: now,
                    phase,
                    key: progress.active.key,
                    completedUnits: progress.active.completedUnits,
                    totalUnits: progress.active.totalUnits,
                    remainingUnits,
                    msPerUnit,
                };
                recomputed = true;
                traceEtaSnapshot({
                    kind: "phase",
                    phase,
                    msPerUnit,
                    remainingUnits,
                    etaSeconds: phaseEta.etaSeconds,
                    sessionCompletedUnits: progress.completedUnits,
                    sessionTotalUnits: progress.totalUnits,
                    activeCompletedUnits: progress.active.completedUnits,
                    activeTotalUnits: progress.active.totalUnits,
                    phaseUnits: progress.active.phaseUnits,
                });
            }
            const elapsed = (now - phaseEta!.computedAt) / 1000;
            const displayedEtaSeconds = Math.max(0, phaseEta!.etaSeconds - elapsed);
            traceEtaSnapshot({
                kind: "phaseDisplay",
                phase,
                recomputed,
                displayedEtaSeconds,
                snapshotEtaSeconds: phaseEta!.etaSeconds,
                elapsedSinceSnapshotSeconds: elapsed,
                msPerUnit: phaseEta!.msPerUnit,
                remainingUnits: phaseEta!.remainingUnits,
                sessionCompletedUnits: progress.completedUnits,
                sessionTotalUnits: progress.totalUnits,
                activeCompletedUnits: progress.active.completedUnits,
                activeTotalUnits: progress.active.totalUnits,
                activePhaseUnits: progress.active.phaseUnits,
                sync: progress.active.sync,
            });
            return displayedEtaSeconds;
        },
    };
}

export function currentMsPerUnit(): number {
    const stats = getTimingStats();
    let totalMs = 0;
    let totalUnits = 0;
    for (const kind in stats) {
        const entry = stats[kind];
        if (entry === undefined) continue;
        totalMs += entry.totalMs;
        totalUnits += entry.totalExpectedUnits;
    }
    if (totalUnits <= 0) return MS_PER_UNIT_PRIOR;
    return totalMs / totalUnits;
}

function phaseRemainingUnits(progress: ImportProgress, phase: ProgressPhase): number {
    const current = progress.active;
    if (current === null) return 0;
    const units = current.phaseUnits;
    const phaseStart =
        phase === "setup"
            ? 0
            : phase === "reading"
              ? units.setup
              : phase === "hydrating"
                ? units.setup + units.reading
                : units.setup + units.reading + units.hydrating;
    const phaseLength = units[phase];
    const phaseEnd = phaseStart + phaseLength;
    const within = current.completedUnits;
    if (within >= phaseEnd) return 0;
    if (within <= phaseStart) return phaseLength;
    return Math.max(0, phaseEnd - within);
}

function isTotalStale(
    snap: EtaSnapshot | null,
    progress: ImportProgress
): boolean {
    if (snap === null) return true;
    const curPhase = progress.active?.phase ?? null;
    const curKey = progress.active?.key ?? "";
    if (snap.phase !== curPhase) return true;
    if (snap.key !== curKey) return true;
    if (snap.completedUnits !== progress.completedUnits) return true;
    if (snap.totalUnits !== progress.totalUnits) return true;
    return false;
}

function isPhaseStale(
    snap: EtaSnapshot | null,
    progress: ImportProgress
): boolean {
    if (snap === null) return true;
    const active = progress.active;
    if (active === null) return true;
    if (snap.phase !== active.phase) return true;
    if (snap.key !== active.key) return true;
    if (snap.completedUnits !== active.completedUnits) return true;
    if (snap.totalUnits !== active.totalUnits) return true;
    return false;
}
