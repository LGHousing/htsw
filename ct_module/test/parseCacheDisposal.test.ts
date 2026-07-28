import { beforeAll, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
    invalidateProjectItems: vi.fn(),
    invalidateItemDependencies: vi.fn(),
    markGuiDirty: vi.fn(),
}));

vi.mock("../src/gui/lib/java", () => ({
    getMtimeMs: () => 1,
    javaType: () => ({
        get: (path: string) => ({
            toAbsolutePath: () => ({
                normalize: () => ({ toString: () => path }),
                toRealPath: () => ({ toString: () => path }),
            }),
        }),
    }),
}));

vi.mock("../src/gui/parsing/parseSnapshot", () => ({
    diffSnapshotFingerprint: () => [],
    loadSnapshot: (path: string) => ({
        importJsonPath: path,
        fingerprint: { [path]: 1 },
    }),
    restoreParseFromSnapshot: (snapshot: { importJsonPath: string }) => ({
        value: [
            {
                type: "FUNCTION",
                name: snapshot.importJsonPath,
                actions: [],
            },
        ],
        importJson: { houseUuid: null },
        gcx: {},
    }),
    saveSnapshot: () => undefined,
}));

vi.mock("../src/gui/parsing/offThreadParse", () => ({
    buildParseFingerprint: () => ({}),
    parseImportJsonOffThread: () => undefined,
}));

vi.mock("../src/importables/items/projectItems", () => ({
    createProjectItemIndex: () => ({}),
    invalidateProjectItemIndex: spies.invalidateProjectItems,
}));

vi.mock("../src/importables/items/dependencyIndex", () => ({
    createItemDependencyIndex: () => ({}),
    invalidateItemDependencyIndex: spies.invalidateItemDependencies,
}));

vi.mock("../src/importCache/houseBindings", () => ({
    recordHouseBinding: () => undefined,
}));

vi.mock("../src/gui/lib/dirty", () => ({
    markGuiDirty: spies.markGuiDirty,
}));

vi.mock("../src/importCache/status", () => ({
    seedImportableHash: () => undefined,
}));

vi.mock("../src/runtimeDebug/slowParseUpload", () => ({
    uploadSlowParseDiagnostics: () => undefined,
}));

type ParsesModule = typeof import("../src/gui/parsing/parses");

let parses: ParsesModule;

beforeAll(async () => {
    parses = await import("../src/gui/parsing/parses");
});

describe("disposeParseCachesUnder", () => {
    it("disposes exact and descendant parses without touching a sibling prefix", () => {
        const exact = parses.parseImportJsonBlocking("/project/a");
        const descendant = parses.parseImportJsonBlocking(
            "/project/a/nested/import.json"
        );
        const sibling = parses.parseImportJsonBlocking("/project/ab/import.json");
        spies.invalidateProjectItems.mockClear();
        spies.invalidateItemDependencies.mockClear();
        spies.markGuiDirty.mockClear();

        parses.disposeParseCachesUnder("/project/a");

        expect(parses.parseCacheSizes()).toEqual({
            canonicalPaths: 1,
            parses: 1,
        });
        expect(spies.invalidateProjectItems).toHaveBeenCalledTimes(2);
        expect(spies.invalidateProjectItems).toHaveBeenCalledWith(exact.parsed?.value);
        expect(spies.invalidateProjectItems).toHaveBeenCalledWith(
            descendant.parsed?.value
        );
        expect(spies.invalidateItemDependencies).toHaveBeenCalledTimes(2);
        expect(parses.getParseAt("/project/ab/import.json")).toBe(sibling);
        expect(spies.markGuiDirty).toHaveBeenCalledOnce();
    });
});
