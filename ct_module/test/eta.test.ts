import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
    getCurrentPhaseEtaSecondsCached,
    getImportEtaSeconds,
    resetEtaCache,
} from "../src/importer/progress/eta";
import type { ImportProgress } from "../src/importer/progress/types";

let now = 0;
const realDateNow = Date.now;

beforeEach(() => {
    now = 0;
    Date.now = () => now;
    resetEtaCache();
});

afterEach(() => {
    Date.now = realDateNow;
    resetEtaCache();
});

function progress(
    completedUnits: number,
    phase: "reading" | "hydrating" | "applying"
): ImportProgress {
    return {
        completedImportables: 0,
        totalImportables: 1,
        completedUnits,
        totalUnits: 120,
        current: {
            key: "FUNCTION:test",
            type: "FUNCTION",
            identity: "test",
            status: "current",
            phase,
            label: "FUNCTION test",
            phaseLabel: phase,
            completedUnits,
            totalUnits: 120,
            phaseUnits: {
                reading: 10,
                hydrating: 100,
                applying: 10,
            },
        },
        rows: [],
        failed: 0,
    };
}

describe("import ETA", () => {
    test("current phase ETA decays while completed units are stalled", () => {
        const p = progress(10, "hydrating");

        expect(getCurrentPhaseEtaSecondsCached(p, 0)).toBe(15);
        now = 5_000;
        expect(getCurrentPhaseEtaSecondsCached(p, 0)).toBe(10);
        now = 12_000;
        expect(getCurrentPhaseEtaSecondsCached(p, 0)).toBe(3);
    });

    test("current phase ETA does not resnap upward on same-phase progress emits", () => {
        const p = progress(10, "hydrating");

        expect(getCurrentPhaseEtaSecondsCached(p, 0)).toBe(15);
        now = 5_000;
        expect(getCurrentPhaseEtaSecondsCached(progress(10, "hydrating"), 0)).toBe(10);
    });

    test("total ETA decays from its snapshot", () => {
        const p = progress(10, "hydrating");

        expect(getImportEtaSeconds(p, 0)).toBe(16.5);
        now = 4_000;
        expect(getImportEtaSeconds(p, 0)).toBe(12.5);
    });
});
