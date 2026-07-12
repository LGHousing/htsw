import { beforeEach, describe, expect, test, vi } from "vitest";

import { readSettingsFile, settingsFilePath } from "../src/persistence/settingsFiles";

describe("persistent settings files", () => {
    let files: Map<string, string>;

    beforeEach(() => {
        files = new Map();
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files.has(path),
            read: (path: string) => files.get(path) ?? null,
            write: (path: string, value: string) => files.set(path, value),
            delete: (path: string) => files.delete(path),
        });
    });

    test("prefers the settings directory and cleans up old copies", () => {
        files.set("./htsw/.settings/trusted-houses.json", "current");
        files.set("./htsw/.state/trusted-houses.json", "intermediate");
        files.set("./htsw/.cache/trusted-houses.json", "legacy");

        expect(readSettingsFile("trusted-houses.json")).toBe("current");
        expect(files.has("./htsw/.state/trusted-houses.json")).toBe(false);
        expect(files.has("./htsw/.cache/trusted-houses.json")).toBe(false);
    });

    test("moves state-directory settings first", () => {
        files.set("./htsw/.state/trusted-houses.json", "intermediate");
        files.set("./htsw/.cache/trusted-houses.json", "legacy");

        expect(readSettingsFile("trusted-houses.json")).toBe("intermediate");
        expect(files.get(settingsFilePath("trusted-houses.json"))).toBe("intermediate");
        expect(files.has("./htsw/.state/trusted-houses.json")).toBe(false);
        expect(files.has("./htsw/.cache/trusted-houses.json")).toBe(false);
    });

    test("moves cache-directory settings when no newer copy exists", () => {
        files.set("./htsw/.cache/trusted-houses.json", "legacy");

        expect(readSettingsFile("trusted-houses.json")).toBe("legacy");
        expect(files.get(settingsFilePath("trusted-houses.json"))).toBe("legacy");
        expect(files.has("./htsw/.cache/trusted-houses.json")).toBe(false);
    });
});
