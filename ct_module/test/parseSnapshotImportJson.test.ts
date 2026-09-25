import { beforeAll, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();

vi.mock("../src/utils/filesystem", () => ({ ensureParentDirs: () => undefined }));
vi.mock("../src/importCache/status", () => ({
    memoizedImportableHash: () => "hash",
    seedImportableHash: () => undefined,
}));

let saveSnapshot: typeof import("../src/gui/parsing/parseSnapshot").saveSnapshot;
let loadSnapshot: typeof import("../src/gui/parsing/parseSnapshot").loadSnapshot;
let restoreParseFromSnapshot: typeof import("../src/gui/parsing/parseSnapshot").restoreParseFromSnapshot;

beforeAll(async () => {
    vi.stubGlobal("FileLib", {
        exists: (path: string) => files.has(path),
        read: (path: string) => files.get(path) ?? null,
        write: (path: string, text: string) => {
            files.set(path, text);
        },
    });
    ({ saveSnapshot, loadSnapshot, restoreParseFromSnapshot } =
        await import("../src/gui/parsing/parseSnapshot"));
});

describe("parse snapshot import.json metadata", () => {
    it("round-trips dangerouslyDeleteEverythingNotInThisFile", () => {
        const importJsonPath = "/project/import.json";
        saveSnapshot(
            importJsonPath,
            {
                value: [],
                importJson: {
                    houseUuid: "b4c73c99-5c54-4e77-a259-2e05d80dd01d",
                    dangerouslyDeleteEverythingNotInThisFile: true,
                    fileTree: null,
                },
                diagnostics: [],
                gcx: { sourceMap: {} },
            } as never,
            { [importJsonPath]: 1 }
        );

        const snapshot = loadSnapshot(importJsonPath);
        expect(snapshot).not.toBeNull();
        const restored = restoreParseFromSnapshot(snapshot!);
        expect(restored.importJson.houseUuid).toBe(
            "b4c73c99-5c54-4e77-a259-2e05d80dd01d"
        );
        expect(restored.importJson.dangerouslyDeleteEverythingNotInThisFile).toBe(true);
    });
});
