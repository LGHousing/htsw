import { beforeEach, describe, expect, test, vi } from "vitest";

const uploadDiagnosticsFile = vi.hoisted(() => vi.fn());

vi.mock("../src/settings", () => ({
    getUploadSlowParseDiagnostics: () => true,
}));
vi.mock("../src/utils/filesystem", () => ({
    ensureParentDirs: () => undefined,
}));
vi.mock("../src/runtimeDebug/importFailureUpload", () => ({
    uploadDiagnosticsFile,
}));
vi.mock("../src/runtimeDebug/runtimeDebugBuffer", () => ({
    recentRuntimeDebugRecords: () => [
        {
            kind: "failure",
            at: 1,
            message: "Could not read /Users/alice/Projects/secret/import.json",
            nested: {
                path: "C:\\Users\\alice\\secret\\function.htsl",
                uri: "file:///Users/alice/Projects/secret/import.json",
                share: "\\\\server\\alice\\secret\\item.snbt",
            },
        },
    ],
}));

function hasAbsolutePath(value: unknown): boolean {
    if (typeof value === "string") {
        const normalized = value.split("\\").join("/");
        return (
            /file:\/+/i.test(normalized) ||
            /(^|[\s("'=:])(?:\/\/[^/]|\/(?!\/)|[A-Za-z]:\/)/.test(normalized)
        );
    }
    if (Array.isArray(value)) return value.some(hasAbsolutePath);
    if (value === null || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return Object.keys(record).some(
        (key) => hasAbsolutePath(key) || hasAbsolutePath(record[key])
    );
}

describe("slow parse upload privacy", () => {
    beforeEach(() => {
        uploadDiagnosticsFile.mockReset();
    });

    test("stable-hashes every absolute path before writing the upload body", async () => {
        const write = vi.fn();
        vi.stubGlobal("FileLib", { write });
        const { uploadSlowParseDiagnostics } = await import(
            "../src/runtimeDebug/slowParseUpload"
        );

        uploadSlowParseDiagnostics({
            canon: "/Users/alice/Projects/secret/import.json",
            durationMs: 6_000,
            source: "full",
            reason: "source files changed",
            changedPaths: [
                "/Users/alice/Projects/secret/actions.htsl",
                "C:\\Users\\alice\\secret\\item.snbt",
            ],
            parsePerf: [
                {
                    path: "/Users/alice/Projects/secret/import.json",
                    ms: 6_000,
                    source: "full",
                    at: 123,
                },
            ],
        });

        expect(write).toHaveBeenCalledOnce();
        const [path, rawBody] = write.mock.calls[0] as unknown as [string, string];
        const body = JSON.parse(rawBody) as Record<string, unknown>;
        expect(hasAbsolutePath(body)).toBe(false);
        expect(body.project).toMatch(/^path:[0-9a-f]+$/);
        expect(body.changedPaths).toEqual([
            expect.stringMatching(/^path:[0-9a-f]+$/),
            expect.stringMatching(/^path:[0-9a-f]+$/),
        ]);
        expect(JSON.stringify(body)).not.toContain("alice");
        expect(uploadDiagnosticsFile).toHaveBeenCalledWith(path);
    });
});
