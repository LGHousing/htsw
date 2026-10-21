import { beforeEach, describe, expect, test } from "vitest";
import type { ImportableFunction } from "htsw/types";

import { createDiffProgressSession } from "@htsw/importer/runtime/diffProgress";
import {
    livePreviewCacheSize,
    previewLinesForFile,
} from "../src/gui/right-panel/import-tab/livePreview";
import {
    clearLastFinishedProgress,
    clearTaskProgress,
    getActiveTaskPath,
    getFinishedTaskSummary,
    getSessionVerb,
    getTaskProgress,
} from "@htsw/importer/runtime/taskProgress";
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
    clearTaskProgress();
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

    test("releases preview state when a diff fails", () => {
        const progress = createDiffProgressSession([sourceFunction()], MANIFEST);
        const sink = progress.sinkFor("FUNCTION");
        progress.start();
        sink.start(["Example"]);
        sink.item(0, "Example");
        sink.events?.emit({
            kind: "observedSnapshot",
            nodes: [{ kind: "action", action: message("live") }],
        });

        expect(livePreviewCacheSize()).toBe(1);
        progress.fail("Housing read failed");

        expect(livePreviewCacheSize()).toBe(0);
        expect(getTaskProgress()).toBeNull();
    });

    test("discards an incomplete snapshot when an individual live read fails", () => {
        const progress = createDiffProgressSession([sourceFunction()], MANIFEST);
        progress.start();
        const sink = progress.sinkFor("FUNCTION");
        sink.start(["Example"]);
        sink.item(0, "Example");
        sink.events?.emit({
            kind: "observedSnapshot",
            nodes: [{ kind: "action", action: message("partial") }],
        });
        const path = getActiveTaskPath()!;
        expect(previewLinesForFile(path)).not.toEqual([]);
        sink.itemFailed?.(0, "Incomplete item action list");
        expect(previewLinesForFile(path)).toEqual([]);
        expect(getTaskProgress()?.rows[0].status).toBe("failed");
        progress.clear();
    });
});

import { readSessions } from "@htsw/importer/runtime/readProgress";
import { createReadLivePreview } from "../src/gui/right-panel/import-tab/readLivePreview";
readSessions.observe(({ type, basePath, observe }) => observe(createReadLivePreview(type, basePath)));
