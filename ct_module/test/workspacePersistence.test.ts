import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/filesystem", () => ({
    atomicWriteText: (path: string, value: string) => {
        try {
            FileLib.write(path, value, true);
            return true;
        } catch (_e) {
            return false;
        }
    },
}));

const WORKSPACE_PATH = "./htsw/.settings/workspace.json";

describe("workspace persistence", () => {
    let files: Map<string, string>;

    beforeEach(() => {
        vi.resetModules();
        files = new Map();
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files.has(path),
            read: (path: string) => files.get(path) ?? null,
            write: (path: string, value: string) => files.set(path, value),
            delete: (path: string) => files.delete(path),
        });
    });

    async function loadWorkspace() {
        return await import("../src/persistence/workspace");
    }

    it("restores a saved slice on the first tick, then captures changes", async () => {
        files.set(WORKSPACE_PATH, JSON.stringify({ items: ["a", "b"] }));
        const ws = await loadWorkspace();

        let live: string[] = [];
        ws.defineWorkspaceSlice<string[]>({
            key: "items",
            fallback: [],
            parse: (raw, fallback) => (Array.isArray(raw) ? (raw as string[]) : fallback),
            capture: () => live,
            restore: (value) => {
                live = value.slice();
            },
        });

        ws.tickWorkspace();
        expect(live).toEqual(["a", "b"]);

        live = ["c"];
        ws.flushWorkspace();
        expect(JSON.parse(files.get(WORKSPACE_PATH)!)).toEqual({ items: ["c"] });
    });

    it("does not restore or save while the setting is off", async () => {
        files.set(
            "./htsw/.settings/settings.json",
            JSON.stringify({ restoreWorkspace: false })
        );
        files.set(WORKSPACE_PATH, JSON.stringify({ items: ["a"] }));
        const ws = await loadWorkspace();

        let live: string[] = [];
        ws.defineWorkspaceSlice<string[]>({
            key: "items",
            fallback: [],
            parse: (raw, fallback) => (Array.isArray(raw) ? (raw as string[]) : fallback),
            capture: () => live,
            restore: (value) => {
                live = value.slice();
            },
        });

        ws.tickWorkspace();
        expect(live).toEqual([]);

        live = ["c"];
        ws.flushWorkspace();
        expect(JSON.parse(files.get(WORKSPACE_PATH)!)).toEqual({ items: ["a"] });
    });

    it("a throwing slice does not cost the other slices their restore", async () => {
        files.set(WORKSPACE_PATH, JSON.stringify({ bad: ["x"], good: ["y"] }));
        const ws = await loadWorkspace();

        let good: string[] = [];
        ws.defineWorkspaceSlice<string[]>({
            key: "bad",
            fallback: [],
            parse: (raw, fallback) => (Array.isArray(raw) ? (raw as string[]) : fallback),
            capture: () => [],
            restore: () => {
                throw new Error("project moved");
            },
        });
        ws.defineWorkspaceSlice<string[]>({
            key: "good",
            fallback: [],
            parse: (raw, fallback) => (Array.isArray(raw) ? (raw as string[]) : fallback),
            capture: () => good,
            restore: (value) => {
                good = value.slice();
            },
        });

        ws.tickWorkspace();
        expect(good).toEqual(["y"]);
    });

    it("reset clears the file and stops the live session writing it back", async () => {
        files.set(WORKSPACE_PATH, JSON.stringify({ items: ["a"] }));
        const ws = await loadWorkspace();

        let live: string[] = [];
        ws.defineWorkspaceSlice<string[]>({
            key: "items",
            fallback: [],
            parse: (raw, fallback) => (Array.isArray(raw) ? (raw as string[]) : fallback),
            capture: () => live,
            restore: (value) => {
                live = value.slice();
            },
        });

        ws.tickWorkspace();
        expect(live).toEqual(["a"]);

        expect(ws.resetWorkspace()).toBe(true);
        expect(JSON.parse(files.get(WORKSPACE_PATH)!)).toEqual({});
        // The open session is deliberately untouched...
        expect(live).toEqual(["a"]);

        // ...but must not be written back, or the next launch is not clean.
        ws.tickWorkspace();
        ws.flushWorkspace();
        expect(JSON.parse(files.get(WORKSPACE_PATH)!)).toEqual({});
    });

    it("flushes on the overlay's visible -> hidden edge only", async () => {
        const ws = await loadWorkspace();
        let live: string[] = [];
        ws.defineWorkspaceSlice<string[]>({
            key: "items",
            fallback: [],
            parse: (raw, fallback) => (Array.isArray(raw) ? (raw as string[]) : fallback),
            capture: () => live,
            restore: (value) => {
                live = value.slice();
            },
        });
        ws.tickWorkspace();

        live = ["a"];
        ws.noteOverlayVisibility(true);
        expect(files.has(WORKSPACE_PATH)).toBe(false);

        ws.noteOverlayVisibility(false);
        expect(JSON.parse(files.get(WORKSPACE_PATH)!)).toEqual({ items: ["a"] });
    });
});
