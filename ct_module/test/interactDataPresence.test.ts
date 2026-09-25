import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportableItem } from "htsw/types";

const disk = vi.hoisted(() => ({
    files: new Map<string, { text: string; mtime: number }>(),
    reads: 0,
}));

vi.mock("../src/utils/filesystem", () => ({
    atomicWriteText: () => true,
    getFileMtimeMs: (path: string) => disk.files.get(path)?.mtime ?? 0,
}));

import { hasInteractDataCache } from "../src/importables/items/interactDataCache";
import type { ItemDependencyIndex } from "../src/importables/items/dependencyIndex";

const item = {
    type: "ITEM",
    name: "Sword",
    nbt: {},
    leftClickActions: [{ type: "MESSAGE", message: "hi" }],
} as unknown as ImportableItem;
const dependencies = {
    clickActionsFingerprint: () => "fingerprint",
} as unknown as ItemDependencyIndex;
const blobPath = "./htsw/.cache/house/interact_data/fingerprint.snbt";

beforeEach(() => {
    disk.files.clear();
    disk.reads = 0;
    vi.stubGlobal("FileLib", {
        exists: (path: string) => disk.files.has(path),
        read: (path: string) => {
            disk.reads++;
            return disk.files.get(path)?.text ?? null;
        },
    });
});

describe("interact-data presence", () => {
    it("reads each blob once per version", () => {
        expect(hasInteractDataCache(item, dependencies, "house")).toBe(false);
        expect(disk.reads).toBe(0);

        disk.files.set(blobPath, { text: "{a:1b}", mtime: 10 });
        expect(hasInteractDataCache(item, dependencies, "house")).toBe(true);
        expect(hasInteractDataCache(item, dependencies, "house")).toBe(true);
        expect(disk.reads).toBe(1);

        disk.files.set(blobPath, { text: "not snbt {", mtime: 20 });
        expect(hasInteractDataCache(item, dependencies, "house")).toBe(false);
        expect(disk.reads).toBe(2);

        disk.files.delete(blobPath);
        expect(hasInteractDataCache(item, dependencies, "house")).toBe(false);
    });
});
