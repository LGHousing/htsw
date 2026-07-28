import { describe, expect, test, vi } from "vitest";
import type { ImportableItem } from "htsw/types";

import { createItemDependencyIndex } from "../src/importables/items/dependencyIndex";
import { createProjectItemIndex } from "../src/importables/items/projectItems";
import { readHouseItemInteractData } from "../src/importables/items/resolveItem";

function item(): ImportableItem {
    return {
        type: "ITEM",
        name: "Relic",
        nbt: {
            type: "compound",
            value: { id: { type: "string", value: "minecraft:stone" } },
        },
        leftClickActions: [{ type: "GIVE_ITEM", itemName: "minecraft:stone" }],
    };
}

describe("readHouseItemInteractData", () => {
    test("uses the verified ITEM knowledge record and its house blob sidecar", () => {
        const relic = item();
        const items = createProjectItemIndex([relic]);
        const dependencies = createItemDependencyIndex([relic], items);
        const uuid = "knowledge-blob-house";
        const knowledgePath = `./htsw/.cache/${uuid}/item/Relic.knowledge.json`;
        const blobPath = `./htsw/.cache/${uuid}/interact_data/${dependencies.clickActionsFingerprint(relic)}.snbt`;
        const files: Record<string, string> = {
            [knowledgePath]: JSON.stringify({
                schemaVersion: 2,
                writtenAt: "2026-07-16T00:00:00.000Z",
                writer: "importer",
                importable: relic,
                hash: "unused",
                lists: {},
            }),
            [blobPath]: '{version:1b,actions:[{type:"chat"}]}',
        };
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
        });

        expect(readHouseItemInteractData(relic, dependencies, uuid)).toBe(
            files[blobPath]
        );
    });

    test("treats knowledge without a blob as genuinely plain", () => {
        const relic = item();
        relic.leftClickActions = undefined;
        const items = createProjectItemIndex([relic]);
        const dependencies = createItemDependencyIndex([relic], items);
        const uuid = "knowledge-plain-house";
        const path = `./htsw/.cache/${uuid}/item/Relic.knowledge.json`;
        vi.stubGlobal("FileLib", {
            exists: (candidate: string) => candidate === path,
            read: (candidate: string) =>
                candidate === path
                    ? JSON.stringify({
                          schemaVersion: 2,
                          writtenAt: "2026-07-16T00:00:00.000Z",
                          writer: "importer",
                          importable: relic,
                          hash: "unused",
                          lists: {},
                      })
                    : null,
        });

        expect(readHouseItemInteractData(relic, dependencies, uuid)).toBeUndefined();
    });
});
