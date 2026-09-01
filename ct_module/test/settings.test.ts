import { beforeEach, describe, expect, test, vi } from "vitest";

describe("diagnostic upload setting", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
    });

    test("defaults to off when the setting has not been persisted", async () => {
        vi.stubGlobal("FileLib", {
            exists: () => false,
            read: () => null,
            write: () => undefined,
        });
        const { getUploadDiagnostics, getUploadDiagnosticsPreference } =
            await import("../src/settings");

        expect(getUploadDiagnostics()).toBe(false);
        expect(getUploadDiagnosticsPreference()).toBe("unset");
    });

    test("honors an explicit on value", async () => {
        vi.stubGlobal("FileLib", {
            exists: () => true,
            read: () => JSON.stringify({ uploadDiagnostics: "enabled" }),
            write: () => undefined,
        });
        const { getUploadDiagnostics } = await import("../src/settings");

        expect(getUploadDiagnostics()).toBe(true);
    });

    test("persists a declined prompt as disabled", async () => {
        const written: string[] = [];
        const write = vi.fn((_path: string, contents: string) => {
            written.push(contents);
        });
        vi.stubGlobal("FileLib", {
            exists: () => false,
            read: () => null,
            write,
        });
        const { getUploadDiagnosticsPreference, setUploadDiagnostics } =
            await import("../src/settings");

        setUploadDiagnostics(false);

        expect(getUploadDiagnosticsPreference()).toBe("disabled");
        expect(JSON.parse(written[0])).toMatchObject({
            uploadDiagnostics: "disabled",
        });
    });
});

describe("unmatched functions first setting", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
    });

    test("defaults to off when the setting has not been persisted", async () => {
        vi.stubGlobal("FileLib", {
            exists: () => false,
            read: () => null,
            write: () => undefined,
        });
        const { getUnmatchedFunctionsFirst } = await import("../src/settings");

        expect(getUnmatchedFunctionsFirst()).toBe(false);
    });

    test("honors an explicit on value", async () => {
        vi.stubGlobal("FileLib", {
            exists: () => true,
            read: () => JSON.stringify({ unmatchedFunctionsFirst: true }),
            write: () => undefined,
        });
        const { getUnmatchedFunctionsFirst } = await import("../src/settings");

        expect(getUnmatchedFunctionsFirst()).toBe(true);
    });

    test("persists changes through the settings document", async () => {
        let written = "";
        vi.stubGlobal("FileLib", {
            exists: () => false,
            read: () => null,
            write: (_path: string, value: string) => {
                written = value;
            },
        });
        const { getUnmatchedFunctionsFirst, setUnmatchedFunctionsFirst } =
            await import("../src/settings");

        setUnmatchedFunctionsFirst(true);

        expect(getUnmatchedFunctionsFirst()).toBe(true);
        expect(JSON.parse(written)).toMatchObject({ unmatchedFunctionsFirst: true });
    });
});

describe("auto-run setting migration", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
    });

    test("inherits the legacy watch-mode toggle", async () => {
        vi.stubGlobal("FileLib", {
            exists: () => true,
            read: () => JSON.stringify({ watchMode: true }),
            write: () => undefined,
        });
        const { getAutoRun } = await import("../src/settings");

        expect(getAutoRun()).toBe(true);
    });

    test("prefers an explicit auto-run value over the legacy key", async () => {
        vi.stubGlobal("FileLib", {
            exists: () => true,
            read: () => JSON.stringify({ watchMode: true, autoRun: false }),
            write: () => undefined,
        });
        const { getAutoRun } = await import("../src/settings");

        expect(getAutoRun()).toBe(false);
    });
});
