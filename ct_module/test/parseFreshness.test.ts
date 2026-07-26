import { beforeAll, describe, expect, it, vi } from "vitest";

const importJsonPath = "/project/import.json";
const htslPath = "/project/functions.htsl";
const mtimes = new Map([
    [importJsonPath, 1],
    [htslPath, 1],
]);
let version = 1;

function parsedProject() {
    const names = version === 1 ? ["pagetest"] : ["pagetest", "pagetest2"];
    return {
        value: names.map((name) => ({
            type: "FUNCTION",
            name,
            actions: version === 1 ? [{ type: "SEND_MESSAGE", message: "old" }] : [
                { type: "SEND_MESSAGE", message: "new" },
                { type: "SEND_MESSAGE", message: "added" },
            ],
        })),
        importJson: { houseUuid: null },
        gcx: { diagnostics: [], sourceMap: {} },
    };
}

vi.mock("../src/gui/lib/java", () => ({
    getMtimeMs: (path: string) => mtimes.get(path) ?? 0,
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

vi.mock("../src/gui/parsing/offThreadParse", () => ({
    buildParseFingerprint: () => ({
        [importJsonPath]: mtimes.get(importJsonPath),
        [htslPath]: mtimes.get(htslPath),
    }),
    parseImportJsonOffThread: (
        _path: string,
        _mtime: number,
        onComplete: (result: unknown) => void
    ) =>
        onComplete({
            parsed: parsedProject(),
            error: null,
            fingerprint: {
                [importJsonPath]: mtimes.get(importJsonPath),
                [htslPath]: mtimes.get(htslPath),
            },
            hashes: version === 1 ? ["old"] : ["new", "new2"],
        }),
}));

vi.mock("../src/gui/parsing/parseSnapshot", () => ({
    diffSnapshotFingerprint: () => [],
    loadSnapshot: () => null,
    restoreParseFromSnapshot: () => null,
    saveSnapshot: () => undefined,
}));
vi.mock("../src/importables/items/projectItems", () => ({
    createProjectItemIndex: () => ({}),
    invalidateProjectItemIndex: () => undefined,
}));
vi.mock("../src/importables/items/dependencyIndex", () => ({
    createItemDependencyIndex: () => ({}),
    invalidateItemDependencyIndex: () => undefined,
}));
vi.mock("../src/importCache/houseBindings", () => ({
    recordHouseBinding: () => undefined,
}));
vi.mock("../src/gui/lib/dirty", () => ({ markGuiDirty: () => undefined }));
vi.mock("../src/importCache/status", () => ({
    seedImportableHash: () => undefined,
}));
vi.mock("../src/runtimeDebug/slowParseUpload", () => ({
    uploadSlowParseDiagnostics: () => undefined,
}));

let parseImportJsonCurrent: typeof import("../src/gui/parsing/parses").parseImportJsonCurrent;

beforeAll(async () => {
    ({ parseImportJsonCurrent } = await import("../src/gui/parsing/parses"));
});

describe("import parse freshness", () => {
    it("reparses changed source files before returning the project", async () => {
        const first = await parseImportJsonCurrent(importJsonPath);
        expect(first.parsed?.value[0]).toMatchObject({
            name: "pagetest",
            actions: [{ message: "old" }],
        });

        version = 2;
        mtimes.set(htslPath, 2);

        const current = await parseImportJsonCurrent(importJsonPath);
        expect(current).not.toBe(first);
        expect(current.parsed?.value[0]).toMatchObject({
            name: "pagetest",
            actions: [{ message: "new" }, { message: "added" }],
        });
    });

    it("returns declarations added to import.json to queue lookup", async () => {
        mtimes.set(importJsonPath, 2);

        const current = await parseImportJsonCurrent(importJsonPath);
        expect(
            current.parsed?.value.some(
                (importable) =>
                    importable.type === "FUNCTION" && importable.name === "pagetest2"
            )
        ).toBe(true);
    });
});
