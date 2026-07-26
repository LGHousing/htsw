import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseWarnModeArgument } from "../src/slashCommands/warnMode";

const SETTINGS_PATH = "./htsw/.settings/overwrite-warning.json";

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

describe("overwrite warning persistence", () => {
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

    it("defaults to always when no setting exists", async () => {
        const warnings = await import("../src/importables/overwriteWarning");

        expect(warnings.getOverwriteWarningMode()).toBe("always");
    });

    it.each(["not json", JSON.stringify("invalid")])(
        "resets corrupt settings and remains writable",
        async (stored) => {
            files.set(SETTINGS_PATH, stored);
            const warnings = await import("../src/importables/overwriteWarning");

            expect(warnings.getOverwriteWarningMode()).toBe("always");
            expect(warnings.setOverwriteWarningMode("off")).toBe(true);
            expect(JSON.parse(files.get(SETTINGS_PATH)!)).toBe("off");
        }
    );

    it("resets an unreadable setting and remains writable", async () => {
        let readable = false;
        vi.stubGlobal("FileLib", {
            exists: (path: string) => path === SETTINGS_PATH,
            read: () => (readable ? '"always"' : null),
            write: (path: string, value: string) => {
                files.set(path, value);
                readable = true;
            },
            delete: () => false,
        });
        const warnings = await import("../src/importables/overwriteWarning");

        expect(warnings.getOverwriteWarningMode()).toBe("always");
        expect(warnings.setOverwriteWarningMode("trusted")).toBe(true);
        expect(JSON.parse(files.get(SETTINGS_PATH)!)).toBe("trusted");
    });
});

describe("warnmode arguments", () => {
    it("rejects unsupported modes and extra arguments", () => {
        expect(parseWarnModeArgument(["sometimes"])).toBeNull();
        expect(parseWarnModeArgument(["always", "off"])).toBeNull();
    });
});
