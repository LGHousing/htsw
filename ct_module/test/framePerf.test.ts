import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    getFramePerfStats,
    recordPanelFrame,
    recordPhase,
    setFramePerfEnabled,
} from "../src/gui/lib/framePerf";

beforeEach(() => {
    setFramePerfEnabled(true);
});

afterEach(() => {
    setFramePerfEnabled(false);
});

describe("frame performance phases", () => {
    it("reports a phase peak separately from its per-rebuild average", () => {
        for (let i = 0; i < 4; i++) recordPanelFrame(1, true);
        recordPhase("codeview.lines", 512);

        const phase = getFramePerfStats().phases.find(
            (entry) => entry.name === "codeview.lines"
        );
        expect(phase).toEqual({
            name: "codeview.lines",
            msPerRebuild: 128,
            maxMs: 512,
        });
    });
});
