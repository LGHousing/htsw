import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const io = vi.hoisted(() => ({
    atomicWriteText: vi.fn<(path: string, content: string) => boolean>(),
}));

vi.mock("../src/utils/filesystem", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/utils/filesystem")>()),
    atomicWriteText: io.atomicWriteText,
    getFileMtimeMs: () => 1,
}));

import {
    deleteHousingCache,
    houseTypeScanned,
    recordHouseScan,
} from "../src/importCache/cache";

const globals = globalThis as unknown as { Java: any; FileLib: any };
const originalJava = globals.Java;
const originalFileLib = globals.FileLib;

function stubEmptyFilesystem(): void {
    const files = {
        exists: vi.fn(() => false),
        notExists: vi.fn(() => true),
        isDirectory: vi.fn(() => false),
        deleteIfExists: vi.fn(() => false),
    };
    globals.Java = {
        type: (name: string) => {
            if (name === "java.nio.file.Paths") return { get: (path: string) => path };
            if (name === "java.nio.file.Files") return files;
            return {};
        },
    };
    globals.FileLib = { ...originalFileLib, exists: () => false };
}

beforeEach(() => {
    io.atomicWriteText.mockReset();
    stubEmptyFilesystem();
});

afterEach(() => {
    globals.Java = originalJava;
    globals.FileLib = originalFileLib;
});

describe("house scan cache reconciliation", () => {
    test("records completion only after every entry is saved", () => {
        io.atomicWriteText.mockReturnValue(true);

        recordHouseScan("complete-house", "COMMAND", ["first", "second"]);

        expect(io.atomicWriteText.mock.calls.map(([path]) => path)).toEqual([
            "./htsw/.cache/complete-house/command/first.knowledge.json",
            "./htsw/.cache/complete-house/command/second.knowledge.json",
            "./htsw/.cache/complete-house/command/.scan-complete",
        ]);
        expect(houseTypeScanned("complete-house", "COMMAND")).toBe(true);
    });

    test("leaves the scan incomplete when an entry cannot be saved", () => {
        io.atomicWriteText.mockReturnValue(false);

        expect(() => recordHouseScan("failed-house", "COMMAND", ["first"]))
            .toThrow("Could not save command scan data");
        expect(io.atomicWriteText).toHaveBeenCalledTimes(1);
        expect(houseTypeScanned("failed-house", "COMMAND")).toBe(false);
    });
});

describe("house cache deletion", () => {
    test("reports whether the cache was missing, deleted, or left behind", () => {
        expect(deleteHousingCache("missing-house")).toBe("missing");

        const files = {
            exists: vi.fn(() => true),
            notExists: vi.fn(() => false),
            isDirectory: vi.fn(() => false),
            deleteIfExists: vi.fn(() => { throw new Error("locked"); }),
        };
        globals.Java = {
            type: (name: string) => {
                if (name === "java.nio.file.Paths") return { get: (path: string) => path };
                if (name === "java.nio.file.Files") return files;
                return {};
            },
        };

        expect(deleteHousingCache("locked-house")).toBe("partial");

        let present = true;
        const deletableFiles = {
            exists: vi.fn(() => present),
            notExists: vi.fn(() => !present),
            isDirectory: vi.fn(() => false),
            deleteIfExists: vi.fn(() => {
                present = false;
                return true;
            }),
        };
        globals.Java = {
            type: (name: string) => {
                if (name === "java.nio.file.Paths") return { get: (path: string) => path };
                if (name === "java.nio.file.Files") return deletableFiles;
                return {};
            },
        };

        expect(deleteHousingCache("deletable-house")).toBe("deleted");
    });
});
