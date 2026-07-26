import { beforeEach, describe, expect, it } from "vitest";

import {
    clearFramePerf,
    getFramePerfStats,
    recordPanelFrame,
    recordPhase,
} from "../src/gui/lib/framePerf";

beforeEach(() => {
    clearFramePerf();
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
