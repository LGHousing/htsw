import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createEtaCalculator, type EtaCalculator } from "../src/housingSync/progress/eta";
import type { ImportProgress } from "../src/housingSync/progress/types";

let now = 0;
const realDateNow = Date.now;
let eta: EtaCalculator;

beforeEach(() => {
    now = 0;
    Date.now = () => now;
    eta = createEtaCalculator();
});

afterEach(() => {
    Date.now = realDateNow;
});

function progress(
    completedUnits: number,
    phase: "setup" | "reading" | "hydrating" | "applying"
): ImportProgress {
    return {
        completedUnits,
        totalUnits: 120,
        active: {
            key: "FUNCTION:test",
            type: "FUNCTION",
            identity: "test",
            phase,
            completedUnits,
            totalUnits: 120,
            phaseUnits: {
                setup: 0,
                reading: 10,
                hydrating: 100,
                applying: 10,
            },
            sync: null,
        },
        parked: {},
        rows: [],
    };
}

describe("import ETA", () => {
    test("cold start uses the prior ms/unit", () => {
        const p = progress(10, "hydrating");
        // elapsedMs=0 → effectiveMsPerUnit = prior (150).
        // Phase remaining for hydrating: within=10, phaseStart=10, phaseEnd=110 → 100 units.
        expect(eta.getPhase(p, 0)).toBe(15);
        // Total remaining: 120-10=110 → 110*150/1000 = 16.5s.
        expect(eta.getTotal(p, 0)).toBe(16.5);
    });

    test("ETA decays smoothly toward a stalled candidate", () => {
        const p = progress(10, "hydrating");
        // Initial snapshot at t=0 with no data: phase ETA = 15s.
        expect(eta.getPhase(p, 0)).toBe(15);
        // No units complete, so the candidate stays flat at 15s. The smoother
        // ticks the displayed value down by wall-clock but eases it back toward
        // that flat candidate, so one second drops a little less than a full
        // second rather than a naive 1:1 countdown.
        now = 1_000;
        const at1 = eta.getPhase(p, 0)!;
        expect(at1).toBeLessThan(15);
        expect(at1).toBeGreaterThan(14);
        // Keeps decaying, but coasts toward candidate − tau rather than
        // draining to zero during the stall.
        now = 3_000;
        const at3 = eta.getPhase(p, 0)!;
        expect(at3).toBeLessThan(at1);
        expect(at3).toBeGreaterThan(12);
    });

    test("a bad early sample is corrected once enough units accumulate", () => {
        // Snapshot 1: 1 unit completed in 1s → observed = 1000 ms/u (6.7× the prior).
        now = 1_000;
        const earlyEta = eta.getPhase(progress(1, "hydrating"), 0)!;
        // Snapshot 2: 80 units in 12s → observed ≈ 150 ms/u (matches the prior).
        // Bayesian blend at 80 samples should bring msPerUnit close to observed,
        // so ETA reflects the real per-unit cost.
        now = 12_000;
        const laterEta = eta.getPhase(progress(80, "hydrating"), 0)!;
        expect(laterEta).toBeLessThan(earlyEta);
        // 30 units remaining * ~150 ms/u ≈ 4.5s. Allow slack for the blend.
        expect(laterEta).toBeGreaterThan(3);
        expect(laterEta).toBeLessThan(7);
    });

    test("setup phase remaining accounts for the setup segment", () => {
        const p: ImportProgress = { ...progress(0, "setup") };
        p.active!.phaseUnits = { setup: 5, reading: 10, hydrating: 100, applying: 10 };
        p.totalUnits = 125;
        // phaseStart for setup = 0, phaseLength = 5, within = 0 → 5 units.
        // ETA = 5 * 150 / 1000 = 0.75s.
        expect(eta.getPhase(p, 0)).toBe(0.75);
    });
});
