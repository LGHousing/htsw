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
            const msPerUnit = currentMsPerUnit();
            const remainingUnits = Math.max(
                0,
                progress.totalUnits - progress.completedUnits
            );
            const candidateEtaSeconds = (remainingUnits * msPerUnit) / 1000;
            const phaseOrKeyChanged =
                totalEta !== null &&
                (totalEta.phase !== (progress.active?.phase ?? null) ||
                    totalEta.key !== (progress.active?.key ?? ""));
            // Display countdown should never jump *up* mid-phase. When the
            // importer discovers more work (totalUnits grows), the naive
            // recompute makes the displayed ETA spike back; the user sees
            // "10,9,8,7,10,9,8,7". Keep the current snapshot unless the
            // candidate is lower (we're ahead of schedule) or the phase /
            // active importable changed (new context, fresh estimate).
            if (totalEta === null || phaseOrKeyChanged) {
                totalEta = {
                    etaSeconds: candidateEtaSeconds,
                    computedAt: now,
                    phase: progress.active?.phase ?? null,
                    key: progress.active?.key ?? "",
                    completedUnits: progress.completedUnits,
                    totalUnits: progress.totalUnits,
                    remainingUnits,
                    msPerUnit,
                };
                recomputed = true;
            } else {
                const elapsedSoFar = (now - totalEta.computedAt) / 1000;
                const currentDisplayed = Math.max(0, totalEta.etaSeconds - elapsedSoFar);
                if (candidateEtaSeconds < currentDisplayed) {
                    totalEta = {
                        etaSeconds: candidateEtaSeconds,
                        computedAt: now,
                        phase: progress.active?.phase ?? null,
                        key: progress.active?.key ?? "",
                        completedUnits: progress.completedUnits,
                        totalUnits: progress.totalUnits,
                        remainingUnits,
                        msPerUnit,
                    };
                    recomputed = true;
                }
            }
            if (recomputed) {
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
            const snap = totalEta;
            const elapsed = (now - snap.computedAt) / 1000;
            const displayedEtaSeconds = Math.max(0, snap.etaSeconds - elapsed);
            traceEtaSnapshot({
                kind: "totalDisplay",
                recomputed,
                displayedEtaSeconds,
                snapshotEtaSeconds: snap.etaSeconds,
                elapsedSinceSnapshotSeconds: elapsed,
                msPerUnit: snap.msPerUnit,
                remainingUnits: snap.remainingUnits,
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
            const msPerUnit = currentMsPerUnit();
            const remainingUnits = phaseRemainingUnits(progress, phase);
            const candidateEtaSeconds = (remainingUnits * msPerUnit) / 1000;
            const phaseOrKeyChanged =
                phaseEta !== null &&
                (phaseEta.phase !== phase || phaseEta.key !== progress.active.key);
            if (phaseEta === null || phaseOrKeyChanged) {
                phaseEta = {
                    etaSeconds: candidateEtaSeconds,
                    computedAt: now,
                    phase,
                    key: progress.active.key,
                    completedUnits: progress.active.completedUnits,
                    totalUnits: progress.active.totalUnits,
                    remainingUnits,
                    msPerUnit,
                };
                recomputed = true;
            } else {
                const elapsedSoFar = (now - phaseEta.computedAt) / 1000;
                const currentDisplayed = Math.max(0, phaseEta.etaSeconds - elapsedSoFar);
                if (candidateEtaSeconds < currentDisplayed) {
                    phaseEta = {
                        etaSeconds: candidateEtaSeconds,
                        computedAt: now,
                        phase,
                        key: progress.active.key,
                        completedUnits: progress.active.completedUnits,
                        totalUnits: progress.active.totalUnits,
                        remainingUnits,
                        msPerUnit,
                    };
                    recomputed = true;
                }
            }
            if (recomputed) {
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
            const psnap = phaseEta;
            const elapsed = (now - psnap.computedAt) / 1000;
            const displayedEtaSeconds = Math.max(0, psnap.etaSeconds - elapsed);
            traceEtaSnapshot({
                kind: "phaseDisplay",
                phase,
                recomputed,
                displayedEtaSeconds,
                snapshotEtaSeconds: psnap.etaSeconds,
                elapsedSinceSnapshotSeconds: elapsed,
                msPerUnit: psnap.msPerUnit,
                remainingUnits: psnap.remainingUnits,
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

const MS_PER_UNIT_TTL_MS = 1000;
let cachedMsPerUnit: { at: number; value: number } | null = null;

export function currentMsPerUnit(): number {
    const now = Date.now();
    if (cachedMsPerUnit !== null && now - cachedMsPerUnit.at < MS_PER_UNIT_TTL_MS) {
        return cachedMsPerUnit.value;
    }
    const stats = getTimingStats();
    let sum = 0;
    let n = 0;
    for (const kind in stats) {
        const entry = stats[kind];
        if (entry === undefined || entry.count === 0) continue;
        if (entry.avgMsPerExpectedUnit <= 0) continue;
        sum += entry.avgMsPerExpectedUnit;
        n++;
    }
    const value = n === 0 ? MS_PER_UNIT_PRIOR : sum / n;
    cachedMsPerUnit = { at: now, value };
    return value;
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

