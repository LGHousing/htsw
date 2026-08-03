import { expect, test, vi } from "vitest";

const parsed = {
    value: [{ type: "FUNCTION", name: "one", actions: [] }],
    diagnostics: [{ level: "warning" }, { level: "error" }],
    importJson: { fileTree: null },
};

vi.mock("htsw", () => ({
    SourceMap: class {
        readonly kind = "source-map";
    },
    parseImportablesResult: () => parsed,
}));

vi.mock("../src/importCache/hash", () => ({
    importableHash: () => "hash",
}));

vi.mock("../src/utils/fileLoaders", () => ({
    FileSystemFileLoader: class {
        readonly kind = "file-loader";
    },
}));

vi.mock("../src/utils/mainThread", () => ({
    runOnMainThread: (callback: () => void) => callback(),
}));

vi.mock("../src/gui/lib/java", () => ({
    getMtimeMs: () => 2,
    javaType: (name: string) => {
        if (name === "java.lang.Runnable") {
            return class {
                readonly run: () => void;

                constructor(value: { run: () => void }) {
                    this.run = value.run;
                }
            };
        }
        return class {
            constructor(private readonly runnable: { run: () => void }) {}

            setDaemon(): void {}

            start(): void {
                this.runnable.run();
            }
        };
    },
}));

vi.mock("../src/gui/parsing/importablePaths", () => ({
    allReferencedPaths: () => ["/project/import.json", "/project/actions.htsl"],
}));

vi.mock("../src/gui/parsing/parseSnapshot", () => ({
    saveSnapshot: () => ({
        hashMs: 0,
        buildMs: 3,
        serializeMs: 4,
        writeMs: 5,
        bytes: 456,
    }),
}));

test("profiles the worker phases and main-thread callback delay", async () => {
    const now = vi
        .spyOn(Date, "now")
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(105)
        .mockReturnValueOnce(106)
        .mockReturnValueOnce(130)
        .mockReturnValueOnce(131)
        .mockReturnValueOnce(140)
        .mockReturnValueOnce(141)
        .mockReturnValueOnce(148)
        .mockReturnValueOnce(149)
        .mockReturnValueOnce(160);
    const { parseImportJsonOffThread } = await import(
        "../src/gui/parsing/offThreadParse"
    );
    const completed = vi.fn();

    parseImportJsonOffThread("/project/import.json", 1, completed);

    expect(completed).toHaveBeenCalledWith({
        parsed,
        error: null,
        fingerprint: {
            "/project/import.json": 1,
            "/project/actions.htsl": 2,
        },
        hashes: ["hash"],
        profile: {
            phases: {
                sourceParseMs: 24,
                referencedPathFingerprintMs: 9,
                importableHashMs: 7,
                snapshotBuildMs: 3,
                snapshotSerializeMs: 4,
                snapshotWriteMs: 5,
            },
            projectShape: {
                referencedPathCount: 2,
                importableCount: 1,
                diagnosticCount: 2,
                snapshotBytes: 456,
            },
            workerStartDelayMs: 5,
            mainThreadCallbackDelayMs: 11,
        },
    });
    now.mockRestore();
});
