import * as htsw from "htsw";
import type { ImportableItem } from "htsw/types";

import {
    canonicalItemShellKey,
    canonicalItemShellTagKey,
    canonicalLiveItemKey,
    portableItemSnbt,
    snbtFromItem,
} from "../../housingSync/items/itemNbt";
import { itemToHtswTag } from "../../utils/nbt";
import { defineHouseExporter } from "../export/exporter";
import { readProjectItemsForExport } from "../export/projectDestination";
import type { ReadFn } from "../export/reader";
import { readClickActions } from "./readClickActions";
import { hasItemClickActions } from "./interactDataCache";
import { tagChild } from "../../housingSync/items/itemTag";

function liveInventoryItem(name: string, projectItems: readonly ImportableItem[]): Item {
    const source = projectItems.find((item) => item.name === name);
    if (source === undefined) throw new Error(`No project item named '${name}'.`);
    const shell = canonicalItemShellTagKey(source.nbt);
    if (
        projectItems.filter((item) => canonicalItemShellTagKey(item.nbt) === shell)
            .length !== 1
    ) {
        throw new Error(
            `Multiple project items share the NBT of '${name}'; cannot identify its live copy.`
        );
    }

    let candidates = new Map<string, Item>();
    const signedCandidates = new Map<string, Item>();
    for (let slot = 0; slot < 36; slot++) {
        const item = Player.getInventory()?.getStackInSlot(slot);
        if (item == null || canonicalItemShellKey(item) !== shell) continue;
        const key = canonicalLiveItemKey(item);
        candidates.set(key, item);
        const tag = itemToHtswTag(item);
        if (
            tagChild(
                tagChild(tagChild(tag, "tag"), "ExtraAttributes"),
                "interact_data"
            ) !== undefined
        ) {
            signedCandidates.set(key, item);
        }
    }
    // A custom item can share its material with plain menu/action references.
    // Prefer live custom copies, but never choose between competing signatures.
    // If all copies lost their actions, read the plain copy to detect removal.
    if (hasItemClickActions(source) && signedCandidates.size > 0)
        candidates = signedCandidates;
    if (candidates.size === 0) {
        throw new Error(
            `No live copy of '${name}' in your inventory. Obtain it from the house, then retry.`
        );
    }
    if (candidates.size !== 1) {
        throw new Error(
            `Inventory copies of '${name}' have different click-action data; cannot choose one.`
        );
    }
    return Array.from(candidates.values())[0];
}

const readInventoryItems = defineHouseExporter<string, "ITEM">({
    type: "ITEM",
    noun: "item",
    // Housing has no name-keyed item list. The adapter below supplies the
    // project's names; a missing live stack fails instead of looking clean.
    list: async () => [],
    capturesActionItems: true,
    reader: {
        kind: "direct",
        read: async (ctx, name, options, state, onReadProgress) => {
            const item = liveInventoryItem(name, options.projectItems ?? []);
            const actions = await readClickActions(
                ctx,
                item,
                {
                    itemReadMode: "export",
                    itemCaptures: state.itemCaptures,
                    progress: onReadProgress,
                    phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
                    events: options.progress?.events,
                },
                options.progress?.eventsForList
            );
            return {
                type: "ITEM",
                name,
                nbt: htsw.nbt.parseSnbtText(
                    portableItemSnbt(snbtFromItem(item, { pretty: false }))
                ),
                leftClickActions: actions.left,
                rightClickActions: actions.right,
            };
        },
    },
    importableOf: (item) => item,
    export: async () => {
        throw new Error("Use Export held item to export an item to your project.");
    },
});

export const readItems: ReadFn = (ctx, options) => {
    if (options.output.kind === "project") {
        throw new Error("Use Export held item to export an item to your project.");
    }
    const projectItems =
        options.projectItems ?? readProjectItemsForExport(options.importJsonPath);
    return readInventoryItems(ctx, {
        ...options,
        projectItems,
        names: options.names ?? projectItems.map((item) => item.name),
    });
};
