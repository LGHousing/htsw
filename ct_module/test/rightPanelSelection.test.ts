import { beforeEach, describe, expect, test, vi } from "vitest";

type SelectionModule = typeof import("../src/gui/right-panel/selection");

let selection: SelectionModule;
let livePath: string | null;

beforeEach(async () => {
    vi.resetModules();
    selection = await import("../src/gui/right-panel/selection");
    livePath = null;
    selection.setLiveTaskPathProvider(() => livePath);
});

describe("right-panel live import tab", () => {
    test("appears while a task is running and clears when the task finishes", () => {
        livePath = "C:/project/functions/foo.htsl";

        selection.onTaskRunningChanged(false, true);
        expect(selection.getTabs()).toEqual([
            { kind: "live", path: "C:/project/functions/foo.htsl" },
        ]);
        expect(selection.isLiveTabActive()).toBe(true);

        livePath = null;
        selection.onTaskRunningChanged(true, false);

        expect(selection.getTabs()).toEqual([]);
        expect(selection.isLiveTabActive()).toBe(false);
        expect(selection.getActivePath()).toBe(null);
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
});
