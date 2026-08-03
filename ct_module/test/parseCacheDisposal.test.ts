import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedParse } from "../src/gui/parsing/parses";

const spies = vi.hoisted(() => ({
    invalidateProjectItems: vi.fn(),
    invalidateItemDependencies: vi.fn(),
    markGuiDirty: vi.fn(),
    disposeLineModels: vi.fn(),
    bumpTreeRevision: vi.fn(),
    directoryPaths: new Set<string>(),
}));

type MockPath = {
    getFileName(): MockPath | null;
    getParent(): MockPath | null;
    normalize(): MockPath;
    toAbsolutePath(): MockPath;
    toRealPath(): MockPath;
    toString(): string;
};

function mockPath(path: string): MockPath {
    const slash = path.lastIndexOf("/");
    return {
        getFileName: () => (slash < 0 ? mockPath(path) : mockPath(path.slice(slash + 1))),
        getParent: () => (slash <= 0 ? null : mockPath(path.slice(0, slash))),
        normalize: () => mockPath(path),
        toAbsolutePath: () => mockPath(path),
        toRealPath: () => mockPath(path),
        toString: () => path,
    };
}

vi.mock("../src/gui/lib/java", () => ({
    getMtimeMs: () => 1,
    runtimeString: (value: string) => value,
    javaType: (name: string) => {
        if (name === "java.util.concurrent.ConcurrentLinkedQueue") {
            return class {
                private readonly values: string[] = [];

                add(value: string): void {
                    this.values.push(value);
                }

                poll(): string | null {
                    return this.values.shift() ?? null;
                }
            };
        }
        if (name === "java.nio.file.Files") {
            return {
                isDirectory: (path: MockPath) =>
                    spies.directoryPaths.has(path.toString()),
                isRegularFile: (path: MockPath) =>
                    !spies.directoryPaths.has(path.toString()),
            };
        }
        return {
            get: (path: string) => mockPath(path),
        };
    },
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
    saveSnapshot: () => ({
        hashMs: 0,
        buildMs: 0,
        serializeMs: 0,
        writeMs: 0,
        bytes: 0,
    }),
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

vi.mock("../src/gui/left-panel/projects/rowModel", () => ({
    bumpTreeRevision: spies.bumpTreeRevision,
}));

vi.mock("../src/gui/state", () => ({
    getImportJsonPath: () => "",
    setImportJsonPath: () => undefined,
}));

vi.mock("../src/gui/code-view/lineModel", () => ({
    disposeLineModelCachesUnder: spies.disposeLineModels,
}));

vi.mock("../src/gui/lib/framePerf", () => ({
    recordPhase: () => undefined,
}));

type ParsesModule = typeof import("../src/gui/parsing/parses");

let parses: ParsesModule;

beforeEach(async () => {
    vi.resetModules();
    spies.directoryPaths.clear();
    spies.invalidateProjectItems.mockClear();
    spies.invalidateItemDependencies.mockClear();
    spies.markGuiDirty.mockClear();
    spies.disposeLineModels.mockClear();
    spies.bumpTreeRevision.mockClear();
    parses = await import("../src/gui/parsing/parses");
});

describe("parse cache retention and disposal", () => {
    it("keeps every parse visible after exceeding the old capacity", () => {
        const entries = Array.from({ length: 130 }, (_, index) =>
            parses.parseImportJsonBlocking(`/project/${index}/import.json`)
        );
        const visible: CachedParse[] = [];

        parses.forEachCachedParse((entry) => visible.push(entry));

        expect(parses.parseCacheSizes().parses).toBe(130);
        expect(visible).toEqual(entries);
        for (let i = 0; i < entries.length; i++) {
            expect(parses.getParseAt(entries[i].canonicalPath)).toBe(entries[i]);
        }
    });

    it("removes a source explicitly without evicting the other parses", async () => {
        const sourcePath = "/project/removed";
        spies.directoryPaths.add(sourcePath);
        const source = await import("../src/gui/left-panel/projects/source");
        source.queueSourcePath(sourcePath);
        expect(source.getSources()).toHaveLength(1);

        const removed = [
            parses.parseImportJsonBlocking(`${sourcePath}/import.json`),
            parses.parseImportJsonBlocking(`${sourcePath}/nested/import.json`),
        ];
        const retained = Array.from({ length: 128 }, (_, index) =>
            parses.parseImportJsonBlocking(`/project/retained/${index}/import.json`)
        );
        spies.invalidateProjectItems.mockClear();
        spies.invalidateItemDependencies.mockClear();
        spies.markGuiDirty.mockClear();

        source.removeSource(sourcePath);

        expect(parses.parseCacheSizes().parses).toBe(128);
        for (let i = 0; i < removed.length; i++) {
            expect(parses.getParseAt(removed[i].canonicalPath)).toBeNull();
        }
        for (let i = 0; i < retained.length; i++) {
            expect(parses.getParseAt(retained[i].canonicalPath)).toBe(retained[i]);
        }
        expect(spies.invalidateProjectItems).toHaveBeenCalledTimes(2);
        expect(spies.invalidateItemDependencies).toHaveBeenCalledTimes(2);
        expect(spies.markGuiDirty).toHaveBeenCalledOnce();
    });

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
