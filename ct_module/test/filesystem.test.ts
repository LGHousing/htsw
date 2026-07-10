import { afterEach, describe, expect, it, vi } from "vitest";

import { atomicWriteText } from "../src/utils/filesystem";

const globals = globalThis as unknown as { Java: any; FileLib: any };
const originalJava = globals.Java;
const originalFileLib = globals.FileLib;

afterEach(() => {
    vi.restoreAllMocks();
    globals.Java = originalJava;
    globals.FileLib = originalFileLib;
});

function stubFilesystem(move: ReturnType<typeof vi.fn>, write: ReturnType<typeof vi.fn>): void {
    const paths = { get: (path: string) => path };
    const files = {
        exists: () => true,
        move,
        deleteIfExists: () => true,
    };
    const options = {
        ATOMIC_MOVE: "atomic",
        REPLACE_EXISTING: "replace",
    };
    globals.Java = {
        type: (name: string) => {
            if (name === "java.nio.file.Paths") return paths;
            if (name === "java.nio.file.Files") return files;
            return options;
        },
    };
    globals.FileLib = { ...originalFileLib, write };
}

describe("atomicWriteText", () => {
    it("retries without ATOMIC_MOVE", () => {
        const move = vi.fn()
            .mockImplementationOnce(() => { throw new Error("unsupported"); })
            .mockImplementationOnce(() => undefined);
        const write = vi.fn();
        stubFilesystem(move, write);

        expect(atomicWriteText("cache/state.json", "contents")).toBe(true);
        // Temp names carry a unique per-write suffix so concurrent writers
        // (two game clients on a shared cache) can't collide on one temp.
        const tempName = expect.stringMatching(/^cache\/state\.json\..+\.tmp$/);
        expect(move).toHaveBeenNthCalledWith(
            1,
            tempName,
            "cache/state.json",
            "atomic",
            "replace"
        );
        expect(move).toHaveBeenNthCalledWith(
            2,
            tempName,
            "cache/state.json",
            "replace"
        );
        expect(write).toHaveBeenCalledTimes(1);
    });

    it("writes the target directly when both moves fail", () => {
        const move = vi.fn(() => { throw new Error("move failed"); });
        const write = vi.fn();
        stubFilesystem(move, write);

        expect(atomicWriteText("cache/state.json", "contents")).toBe(true);
        expect(write).toHaveBeenNthCalledWith(
            1,
            expect.stringMatching(/^cache\/state\.json\..+\.tmp$/),
            "contents",
            true
        );
        expect(write).toHaveBeenNthCalledWith(
            2,
            "cache/state.json",
            "contents",
            true
        );
    });
});
