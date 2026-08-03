import { beforeAll, describe, expect, it, vi } from "vitest";

const importJsonPath = "/project/import.json";
const htslPath = "/project/functions.htsl";
const mtimes = new Map([
    [importJsonPath, 1],
    [htslPath, 1],
]);
for (let i = 0; i < 694; i++) {
    mtimes.set(`/project/dependency-${i}.htsl`, 1);
}
let version = 1;

function currentFingerprint() {
    const fingerprint: { [path: string]: number } = {};
    for (const [path, mtime] of mtimes) fingerprint[path] = mtime;
    return fingerprint;
}

function parsedProject() {
    const names = version === 1 ? ["pagetest"] : ["pagetest", "pagetest2"];
    return {
        value: names.map((name) => ({
            type: "FUNCTION",
            name,
            actions:
                version === 1
                    ? [{ type: "SEND_MESSAGE", message: "old" }]
                    : [
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
            hashes: version === 1 ? ["old"] : ["new", "new2"],
            profile: null,
        }),
}));

vi.mock("../src/gui/parsing/parseSnapshot", () => ({
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
let requestParse: typeof import("../src/gui/parsing/parses").requestParse;
let isParsePending: typeof import("../src/gui/parsing/parses").isParsePending;
let processPendingParses: typeof import("../src/gui/parsing/parses").processPendingParses;

beforeAll(async () => {
    ({ parseImportJsonCurrent, requestParse, isParsePending, processPendingParses } =
        await import("../src/gui/parsing/parses"));
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

    it("finishes stable background revalidation without keeping a large parse pending", async () => {
        vi.useFakeTimers();
        vi.advanceTimersByTime(400);

        expect(Object.keys(requestParse(importJsonPath)?.fingerprint ?? {})).toHaveLength(
            696
        );
        expect(isParsePending(importJsonPath)).toBe(false);
        processPendingParses();
        await vi.runAllTimersAsync();

        expect(isParsePending(importJsonPath)).toBe(false);
        vi.useRealTimers();
    });
});
