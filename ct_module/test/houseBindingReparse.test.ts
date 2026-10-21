import { beforeAll, describe, expect, it, vi } from "vitest";

const importJsonPath = "/project/import.json";
const houseUuid = "b4c73c99-5c54-4e77-a259-2e05d80dd01d";
const mtimes = new Map([[importJsonPath, 1]]);
let fileHouseUuid: string | null = null;

function currentFingerprint() {
    const fingerprint: { [path: string]: number } = {};
    for (const [path, mtime] of mtimes) fingerprint[path] = mtime;
    return fingerprint;
}

// Mirrors the parser: an armed delete key without a houseUuid is refused with
// an error and disarmed.
function parsedProject() {
    const bound = fileHouseUuid !== null;
    return {
        value: [],
        importJson: {
            houseUuid: fileHouseUuid,
            dangerouslyDeleteEverythingNotInThisFile: bound,
        },
        diagnostics: bound ? [] : [{ level: "error", message: "requires `houseUuid`" }],
        gcx: {
            diagnostics: bound
                ? []
                : [{ level: "error", message: "requires `houseUuid`" }],
            sourceMap: {},
        },
    };
}

vi.mock("../src/utils/java", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/utils/java")>()),
    javaType: () => ({
        get: (path: string) => ({
            toAbsolutePath: () => ({
                toRealPath: () => ({
                    toString: () => path,
                }),
            }),
        }),
    }),
}));
vi.mock("../src/utils/filesystem", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/utils/filesystem")>()),
    getMtimeMs: (path: string) => mtimes.get(path) ?? 0,
}));

vi.mock("@htsw/importer/runtime/parsing/offThreadParse", () => ({
    buildParseFingerprint: () => currentFingerprint(),
    parseImportJsonOffThread: (
        _path: string,
        _mtime: number,
        onComplete: (result: unknown) => void
    ) =>
        onComplete({
            parsed: parsedProject(),
            error: null,
            fingerprint: currentFingerprint(),
            hashes: [],
            profile: null,
        }),
}));

vi.mock("@htsw/importer/runtime/parsing/parseSnapshot", () => ({
    diffSnapshotFingerprint: () => [],
    loadSnapshot: () => null,
    restoreParseFromSnapshot: () => null,
    saveSnapshot: () => ({
        hashMs: 0,
        buildMs: 0,
        serializeMs: 0,
        writeMs: 0,
        bytes: 0,
    }),
}));
vi.mock("@htsw/importer/importables/items/projectItems", () => ({
    createProjectItemIndex: () => ({}),
    invalidateProjectItemIndex: () => undefined,
}));
vi.mock("@htsw/importer/importables/items/dependencyIndex", () => ({
    createItemDependencyIndex: () => ({}),
    invalidateItemDependencyIndex: () => undefined,
}));
vi.mock("@htsw/importer/importCache/houseBindings", () => ({
    recordHouseBinding: () => undefined,
}));
vi.mock("@htsw/importer/importCache/status", () => ({
    seedImportableHash: () => undefined,
}));
vi.mock("@htsw/importer/runtimeDebug/slowParseUpload", () => ({
    uploadSlowParseDiagnostics: () => undefined,
}));

vi.mock("../src/gui/lib/icons.generated", () => ({ Icons: { house: "house" } }));
vi.mock("@htsw/importer/project/pathDisplay", () => ({ shortPath: (path: string) => path }));
vi.mock("../src/gui/popovers/confirm", () => ({
    openConfirmPopover: (options: { onConfirm: () => void }) => options.onConfirm(),
}));
vi.mock("@htsw/importer/runtime/state/index", () => ({
    getHousingUuid: () => houseUuid,
    setExportImportJsonPath: () => undefined,
}));
vi.mock("@htsw/importer/importCache/aliases", () => ({
    houseDisplayName: (uuid: string) => uuid,
}));
vi.mock("@htsw/importer/project/importJsonMutations", () => ({
    setHouseUuidKey: (path: string, uuid: string | null) => {
        fileHouseUuid = uuid;
        mtimes.set(path, (mtimes.get(path) ?? 0) + 1);
        return true;
    },
}));

let parseImportJsonCurrent: typeof import("@htsw/importer/runtime/parsing/parses").parseImportJsonCurrent;
let confirmRebind: typeof import("../src/gui/houseBinding").confirmRebind;

beforeAll(async () => {
    vi.stubGlobal("ChatLib", { chat: () => undefined });
    ({ parseImportJsonCurrent } = await import("@htsw/importer/runtime/parsing/parses"));
    ({ confirmRebind } = await import("../src/gui/houseBinding"));
});

describe("house binding", () => {
    it("re-parses on bind instead of keeping the unbound parse's diagnostics", async () => {
        const unbound = await parseImportJsonCurrent(importJsonPath);
        expect(unbound.parsed?.importJson.houseUuid).toBeNull();
        expect(unbound.parsed?.gcx.diagnostics).toHaveLength(1);

        confirmRebind(importJsonPath, houseUuid);

        const bound = await parseImportJsonCurrent(importJsonPath);
        expect(bound.parsed?.importJson.houseUuid).toBe(houseUuid);
        expect(bound.parsed?.importJson.dangerouslyDeleteEverythingNotInThisFile).toBe(
            true
        );
        expect(bound.parsed?.gcx.diagnostics).toHaveLength(0);
    });
});
