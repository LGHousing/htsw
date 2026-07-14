import { beforeEach, describe, expect, test, vi } from "vitest";

const ALIAS_FILE = "./htsw/.settings/housing-aliases.json";

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

describe("house alias persistence", () => {
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

    test("does not replace a malformed alias map", async () => {
        files.set(ALIAS_FILE, "not json");
        const aliases = await import("../src/importCache/aliases");

        expect(aliases.setAlias("house-a", "Home")).toBe(false);
        expect(files.get(ALIAS_FILE)).toBe("not json");
    });
});
