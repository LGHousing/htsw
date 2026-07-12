import { beforeEach, describe, expect, test, vi } from "vitest";

const AUTO_TRACK_FILE = "./htsw/.cache/auto-track.json";

vi.mock("../src/gui/parsing/parses", () => ({
    canonicalPath: (path: string) => path.replace(/\\/g, "/").toLowerCase(),
}));

describe("auto-track persistence", () => {
    let files: Map<string, string>;

    beforeEach(() => {
        vi.resetModules();
        files = new Map();
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files.has(path),
            read: (path: string) => files.get(path) ?? null,
            write: (path: string, value: string) => files.set(path, value),
        });
    });

    test("restores enabled base import.json paths after reload", async () => {
        const firstLoad = await import("../src/gui/state/autoTrack");

        expect(firstLoad.toggleAutoTrackSource("C:\\Projects\\House\\import.json")).toBe(true);
        expect(JSON.parse(files.get(AUTO_TRACK_FILE) ?? "[]")).toEqual([
            "c:/projects/house/import.json",
        ]);

        vi.resetModules();
        const reloaded = await import("../src/gui/state/autoTrack");

        expect(reloaded.isAutoTrackSource("C:/PROJECTS/HOUSE/import.json")).toBe(true);
        expect(reloaded.isAnyAutoTrackEnabled()).toBe(true);
    });

    test("persists disabling a tracked path", async () => {
        files.set(AUTO_TRACK_FILE, JSON.stringify(["c:/projects/house/import.json"]));
        const state = await import("../src/gui/state/autoTrack");

        expect(state.toggleAutoTrackSource("C:/Projects/House/import.json")).toBe(false);
        expect(JSON.parse(files.get(AUTO_TRACK_FILE) ?? "null")).toEqual([]);
    });
});
