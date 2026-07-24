import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
    createEtaCalculator,
    easeEta,
    sessionBlendedMsPerUnit,
    type EtaCalculator,
} from "../src/housingSync/progress/eta";
import type { TaskProgress } from "../src/housingSync/progress/types";

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
): TaskProgress {
    return {
        completedUnits,
        totalUnits: 120,
        totalsLocked: false,
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
    test("small candidate rises leave the target unchanged while display moves", () => {
        const next = easeEta(
            { displayed: 100, target: 100, at: 0 },
            107,
            1_000
        );
        expect(next.target).toBe(100);
        expect(next.displayed).toBeLessThan(100);
    });

    test("large candidate rises still ease or snap upward", () => {
        const eased = easeEta(
            { displayed: 100, target: 100, at: 0 },
            110,
            1_000
        );
        expect(eased.displayed).toBeGreaterThan(100);
        expect(eased.displayed).toBeLessThan(110);

        expect(easeEta({ displayed: 10, target: 10, at: 0 }, 24, 1_000)).toEqual({
            displayed: 24,
            target: 24,
            at: 1_000,
        });
    });

    test("session rate takes over from the prior as units accumulate", () => {
        const early = sessionBlendedMsPerUnit(180, 140, 10);
        const mature = sessionBlendedMsPerUnit(180, 140, 1_500);

        expect(early).toBeCloseTo(177.5);
        expect(mature).toBeCloseTo(143.636, 3);
        expect(Math.abs(mature - 140)).toBeLessThan(Math.abs(early - 140));
    });

    test("pathological session rates are ignored", () => {
        expect(sessionBlendedMsPerUnit(150, 1_501, 1_000)).toBe(150);
        expect(sessionBlendedMsPerUnit(150, 14.9, 1_000)).toBe(150);
    });

    test("cold start uses the prior ms/unit", () => {
        const p = progress(10, "hydrating");
        // elapsedMs=0 → effectiveMsPerUnit = prior (150).
        // Phase remaining for hydrating: within=10, phaseStart=10, phaseEnd=110 → 100 units.
        expect(eta.getPhase(p, 0)).toBe(15);
        // Total remaining: 120-10=110 → 110*150/1000 = 16.5s.
        expect(eta.getTotal(p, 0)).toBe(16.5);
    });

    test("session-blended candidate stays flat between progress events", () => {
        const p = progress(10, "hydrating");
        expect(eta.getPhase(p, 0)).toBe(15);
        now = 1_000;
        const at1 = eta.getPhase(p, 0)!;
        expect(at1).toBeLessThan(15);
        expect(at1).toBeGreaterThan(14);
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

    test("phase ETA covers parked rows still waiting for the phase", () => {
        const p = progress(10, "hydrating");
        // A scanned row waiting for pass-2: read done (completed = setup +
        // reading), hydration units unspent.
        p.parked["FUNCTION:waiting"] = {
            key: "FUNCTION:waiting",
            type: "FUNCTION",
            identity: "waiting",
            phase: "reading",
            completedUnits: 10,
            totalUnits: 70,
            phaseUnits: { setup: 0, reading: 10, hydrating: 50, applying: 10 },
            sync: null,
        };
        // A row already hydrated and parked again: its hydrating units were
        // trued to zero, so it must not inflate the countdown.
        p.parked["FUNCTION:done"] = {
            key: "FUNCTION:done",
            type: "FUNCTION",
            identity: "done",
            phase: "hydrating",
            completedUnits: 60,
            totalUnits: 70,
            phaseUnits: { setup: 0, reading: 60, hydrating: 0, applying: 10 },
            sync: null,
        };
        // Active remaining 100 + waiting row's 50 = 150 units * 150 ms/u.
        expect(eta.getPhase(p, 0)).toBe(22.5);
    });

    test("setup phase remaining accounts for the setup segment", () => {
        const p: TaskProgress = { ...progress(0, "setup") };
        p.active!.phaseUnits = { setup: 5, reading: 10, hydrating: 100, applying: 10 };
        p.totalUnits = 125;
        // phaseStart for setup = 0, phaseLength = 5, within = 0 → 5 units.
        // ETA = 5 * 150 / 1000 = 0.75s.
        expect(eta.getPhase(p, 0)).toBe(0.75);
    });
});
