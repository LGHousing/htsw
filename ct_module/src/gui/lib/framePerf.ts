/// <reference types="../../../CTAutocomplete" />

/**
 * Rolling stats over the panel's painted frames, for `/htsw debug guiperf`.
 * Answers the two questions a "scrolling feels laggy" report needs split
 * apart: how often frames actually paint (gap → fps), and how much of each
 * frame the overlay itself costs (rebuild frames vs draw-only frames).
 */

const WINDOW = 240;

type FrameSample = {
    gapMs: number;
    renderMs: number;
    rebuilt: boolean;
};

const samples: FrameSample[] = [];
let lastFrameAt = 0;

// Named slices of rebuild time (the tree's renderRows, the code view's
// children build, ...). Children closures only run while a rebuild lays the
// tree out, so total-per-phase / rebuild count = avg cost per rebuild frame.
const phaseTotals: { [name: string]: number } = {};
const phaseMaxes: { [name: string]: number } = {};
let rebuildsSinceClear = 0;

export function recordPhase(name: string, ms: number): void {
    phaseTotals[name] = (phaseTotals[name] ?? 0) + ms;
    phaseMaxes[name] = Math.max(phaseMaxes[name] ?? 0, ms);
}

export function recordPanelFrame(renderMs: number, rebuilt: boolean): void {
    if (rebuilt) rebuildsSinceClear++;
    const now = Date.now();
    // A gap while the overlay wasn't painting (GUI closed, other screen) is
    // a session boundary, not a slow frame.
    const rawGap = lastFrameAt === 0 ? 0 : now - lastFrameAt;
    lastFrameAt = now;
    const gapMs = rawGap > 1000 ? 0 : rawGap;
    samples.push({ gapMs, renderMs, rebuilt });
    if (samples.length > WINDOW) samples.shift();
}

export function clearFramePerf(): void {
    samples.length = 0;
    lastFrameAt = 0;
    rebuildsSinceClear = 0;
    for (const k in phaseTotals) delete phaseTotals[k];
    for (const k in phaseMaxes) delete phaseMaxes[k];
}

export type FramePerfStats = {
    frames: number;
    avgGapMs: number;
    p95GapMs: number;
    maxGapMs: number;
    rebuiltFrames: number;
    avgRebuildMs: number;
    maxRebuildMs: number;
    avgDrawOnlyMs: number;
    /** Avg ms per rebuild frame and peak invocation for each named rebuild slice. */
    phases: { name: string; msPerRebuild: number; maxMs: number }[];
};

export function getFramePerfStats(): FramePerfStats {
    const gaps: number[] = [];
    let gapSum = 0;
    let rebuiltFrames = 0;
    let rebuildSum = 0;
    let maxRebuildMs = 0;
    let drawOnlyFrames = 0;
    let drawOnlySum = 0;
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (s.gapMs > 0) {
            gaps.push(s.gapMs);
            gapSum += s.gapMs;
        }
        if (s.rebuilt) {
            rebuiltFrames++;
            rebuildSum += s.renderMs;
            if (s.renderMs > maxRebuildMs) maxRebuildMs = s.renderMs;
        } else {
            drawOnlyFrames++;
            drawOnlySum += s.renderMs;
        }
    }
    gaps.sort((a, b) => a - b);
    const p95 = gaps.length === 0 ? 0 : gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))];
    const phases: { name: string; msPerRebuild: number; maxMs: number }[] = [];
    if (rebuildsSinceClear > 0) {
        for (const name in phaseTotals) {
            phases.push({
                name,
                msPerRebuild: phaseTotals[name] / rebuildsSinceClear,
                maxMs: phaseMaxes[name] ?? 0,
            });
        }
        phases.sort((a, b) => b.msPerRebuild - a.msPerRebuild);
    }
    return {
        frames: samples.length,
        avgGapMs: gaps.length === 0 ? 0 : gapSum / gaps.length,
        p95GapMs: p95,
        maxGapMs: gaps.length === 0 ? 0 : gaps[gaps.length - 1],
        rebuiltFrames,
        avgRebuildMs: rebuiltFrames === 0 ? 0 : rebuildSum / rebuiltFrames,
        maxRebuildMs,
        avgDrawOnlyMs: drawOnlyFrames === 0 ? 0 : drawOnlySum / drawOnlyFrames,
        phases,
    };
}
