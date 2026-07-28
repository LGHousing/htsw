import { beforeEach, describe, expect, test } from "vitest";
import type { ImportableFunction } from "htsw/types";

import { createDiffProgressSession } from "../src/gui/right-panel/import-tab/diffProgress";
import { clearHousingOperationProgress } from "../src/gui/right-panel/import-tab/housingOperationProgress";
import {
    clearLastFinishedProgress,
    getActiveTaskPath,
    getFinishedTaskSummary,
    getSessionVerb,
    getTaskProgress,
} from "../src/gui/right-panel/import-tab/taskProgress";
import { message } from "./utils";

const MANIFEST = "./project/import.json";

function sourceFunction(): ImportableFunction {
    return {
        type: "FUNCTION",
        name: "Example",
        actions: [message("source")],
    };
}

beforeEach(() => {
    clearHousingOperationProgress();
    clearLastFinishedProgress();
});

describe("diff progress", () => {
    test("publishes operation state at task start and finishes it on success", () => {
        const progress = createDiffProgressSession([sourceFunction()], MANIFEST);

        expect(getTaskProgress()).toBeNull();
        progress.start();

        expect(getTaskProgress()?.rows).toHaveLength(1);
        expect(getSessionVerb()).toBe("diff");
        expect(getActiveTaskPath()).toBe(MANIFEST);

        progress.complete("1 clean / 0 conflicts / 0 unknown");

        expect(getTaskProgress()).toBeNull();
        expect(getActiveTaskPath()).toBeNull();
        expect(getFinishedTaskSummary()).toEqual({
            title: "Diff complete",
            message: "1 clean / 0 conflicts / 0 unknown",
        });
    });

    test("clears operation state when a diff is cancelled", () => {
        const progress = createDiffProgressSession([sourceFunction()], MANIFEST);
        progress.start();

        progress.clear();

        expect(getTaskProgress()).toBeNull();
        expect(getActiveTaskPath()).toBeNull();
        expect(getFinishedTaskSummary()).toBeNull();
    });
});
