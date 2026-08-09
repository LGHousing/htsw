import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Importable } from "htsw/types";

type SelectionModule = typeof import("../src/gui/right-panel/selection");
type LivePreviewModule = typeof import("../src/gui/right-panel/import-tab/livePreview");

let selection: SelectionModule;
let livePreview: LivePreviewModule;
let livePath: string | null;

beforeEach(async () => {
    vi.resetModules();
    selection = await import("../src/gui/right-panel/selection");
    livePreview = await import("../src/gui/right-panel/import-tab/livePreview");
    livePath = null;
    selection.setLiveTaskPathProvider(() => livePath);
});

function functionImportable(): Importable {
    return {
        type: "FUNCTION",
        name: "preview",
        actions: [{ type: "MESSAGE", message: "visible" }],
    };
}

describe("right-panel live import tab", () => {
    test("appears while a task is running and clears when the task finishes", () => {
        livePath = "C:/project/functions/foo.htsl";

        selection.onTaskRunningChanged(false, true);
        expect(selection.getTabs()).toEqual([
            { kind: "live", path: "C:/project/functions/foo.htsl" },
        ]);
        expect(selection.isLiveTabActive()).toBe(true);
        livePreview.primeWithCache(livePath, functionImportable());

        livePath = null;
        selection.onTaskRunningChanged(true, false);

        expect(selection.getTabs()).toEqual([]);
        expect(selection.isLiveTabActive()).toBe(false);
        expect(selection.getActivePath()).toBe(null);
        expect(livePreview.livePreviewCacheSize()).toBe(0);
    });

    test("does not revive the last live path after finish", () => {
        livePath = "C:/project/functions/foo.htsl";
        selection.onTaskRunningChanged(false, true);
        expect(selection.getTabs()).toHaveLength(1);

        livePath = null;
        selection.onTaskRunningChanged(true, false);
        livePath = null;

        expect(selection.getTabs()).toEqual([]);
    });

    test("keeps a failed import preview available for attention", async () => {
        const taskProgress = await import(
            "../src/gui/right-panel/import-tab/taskProgress"
        );
        livePath = "C:/project/functions/foo.htsl";
        taskProgress.startTaskProgress({
            progress: taskProgress.createTaskProgress({}),
            verb: "import",
            path: livePath,
        });
        livePreview.primeWithCache(livePath, functionImportable());

        taskProgress.finishTaskProgress("Housing rejected the edit");

        expect(selection.getTabs()).toEqual([
            { kind: "live", path: "C:/project/functions/foo.htsl" },
        ]);
        expect(selection.isLiveTabActive()).toBe(true);
        expect(
            livePreview.previewLinesForFile("C:/project/functions/foo.htsl")
        ).toHaveLength(1);
        expect(livePreview.livePreviewCacheSize()).toBe(1);
    });

    test("disposes a failed preview when its live tab is dismissed", () => {
        livePath = "C:/project/functions/foo.htsl";
        selection.onTaskRunningChanged(false, true);
        livePreview.primeWithCache(livePath, functionImportable());
        selection.rememberLiveTaskPath(livePath);
        livePath = null;
        selection.onTaskRunningChanged(true, false, true);

        selection.closeLiveTab();

        expect(selection.getTabs()).toEqual([]);
        expect(livePreview.previewLinesForFile("C:/project/functions/foo.htsl")).toEqual(
            []
        );
    });

    test("disposes the previous preview when the next task starts", () => {
        const failedPath = "C:/project/functions/failed.htsl";
        livePath = failedPath;
        selection.onTaskRunningChanged(false, true);
        livePreview.primeWithCache(failedPath, functionImportable());
        selection.rememberLiveTaskPath(failedPath);
        livePath = null;
        selection.onTaskRunningChanged(true, false, true);

        livePath = "C:/project/functions/next.htsl";
        selection.onTaskRunningChanged(false, true);

        expect(livePreview.previewLinesForFile(failedPath)).toEqual([]);
        expect(selection.getTabs()).toEqual([
            { kind: "live", path: "C:/project/functions/next.htsl" },
        ]);
    });
});

describe("right-panel project tabs", () => {
    test("closes only tabs from the project being left", () => {
        const oldProject = "C:/projects/old/import.json";
        const newProject = "C:/projects/new/import.json";
        selection.confirmSelect("C:/projects/old/one.htsl", oldProject);
        selection.confirmSelect("C:/projects/old/two.htsl", oldProject);
        selection.confirmSelect("C:/projects/new/keep.htsl", newProject);

        selection.closeTabsForProject(oldProject);

        expect(selection.getTabs()).toEqual([
            {
                kind: "file",
                path: "C:/projects/new/keep.htsl",
                importJsonPath: newProject,
                confirmed: true,
            },
        ]);
    });
});
