import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
    createEtaCalculator,
    easeEta,
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
        const next = easeEta({ displayed: 100, target: 100, at: 0 }, 107, 1_000);
        expect(next.target).toBe(100);
        expect(next.displayed).toBeLessThan(100);
    });

    test("large candidate rises still ease or snap upward", () => {
        const eased = easeEta({ displayed: 100, target: 100, at: 0 }, 110, 1_000);
        expect(eased.displayed).toBeGreaterThan(100);
        expect(eased.displayed).toBeLessThan(110);

        expect(easeEta({ displayed: 10, target: 10, at: 0 }, 24, 1_000)).toEqual({
            displayed: 24,
            target: 24,
            at: 1_000,
        });
    });

    test("cold start uses the prior ms/unit", () => {
        const p = progress(10, "hydrating");
        // Phase remaining for hydrating: within=10, phaseStart=10, phaseEnd=110 → 100 units.
        expect(eta.getPhase(p)).toBe(15);
        // Total remaining: 120-10=110 → 110*150/1000 = 16.5s.
        expect(eta.getTotal(p)).toBe(16.5);
    });

    test("candidate stays flat between progress events", () => {
        const p = progress(10, "hydrating");
        expect(eta.getPhase(p)).toBe(15);
        now = 1_000;
        const at1 = eta.getPhase(p)!;
        expect(at1).toBeLessThan(15);
        expect(at1).toBeGreaterThan(14);
        now = 3_000;
        const at3 = eta.getPhase(p)!;
        expect(at3).toBeLessThan(at1);
        expect(at3).toBeGreaterThan(12);
    });

    test("totals lock replaces the opening estimate immediately", () => {
        const p = progress(10, "hydrating");
        expect(eta.getTotal(p)).toBe(16.5);

        p.totalUnits = 80;
        p.totalsLocked = true;
        expect(eta.getTotal(p)).toBe(10.5);
    });

    test("phase ETA covers parked rows still waiting for the phase", () => {
        const p = progress(10, "hydrating");
        // A scanned row waiting for hydration: reading is complete and
        // hydration units are unspent.
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
        expect(eta.getPhase(p)).toBe(22.5);
    });

    test("setup phase remaining accounts for the setup segment", () => {
        const p: TaskProgress = { ...progress(0, "setup") };
        p.active!.phaseUnits = { setup: 5, reading: 10, hydrating: 100, applying: 10 };
        p.totalUnits = 125;
        // phaseStart for setup = 0, phaseLength = 5, within = 0 → 5 units.
        // ETA = 5 * 150 / 1000 = 0.75s.
        expect(eta.getPhase(p)).toBe(0.75);
    });
});
