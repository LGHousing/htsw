import type { ImportableItem } from "htsw/types";

import { itemDependencyIndexFor } from "../../importables/items/dependencyIndex";
import {
    hasItemClickActions,
    readInteractDataCache,
} from "../../importables/items/interactDataCache";
import type TaskContext from "../../tasks/context";
import { TaskManager } from "../../tasks/manager";
import { readTextFileOrNull } from "../../utils/filesystem";
import { getItemFromNbt, getItemFromSnbt, itemWithInteractData } from "../../utils/nbt";
import { closeOpenScreen } from "../sideEffects";
import { runHousingSyncTask } from "../taskRunner";
import { injectIntoInventorySlot } from "./heldItem";
import { readInventorySlot } from "./playerInventory";

const INVENTORY_SIZE = 36;

export type GiveableItem = { label: string; item: Item };

export type ResolvedGive =
    | { ok: true; item: Item; signed: boolean }
    | { ok: false; reason: string };

export type GiveSummary = {
    given: number;
    total: number;
    /** Why the batch stopped short of `total`, if it did. */
    stopped: { kind: "full" } | { kind: "error"; label: string; message: string } | null;
};

/**
 * Why an item row's Give is unavailable, or null when it can be given. Give is
 * disabled rather than handing out an unsigned copy, since click actions only
 * work once Housing has signed them.
 */
export function unsignedGiveReason(
    importable: ImportableItem,
    housingUuid: string | null
): string | null {
    if (!hasItemClickActions(importable)) return null;
    if (housingUuid === null) return "Join a house first";
    const dependencies = itemDependencyIndexFor(importable);
    if (dependencies === undefined) return "Project not indexed yet";
    if (readInteractDataCache(importable, dependencies, housingUuid) === undefined) {
        return "Import it first to sign its click actions";
    }
    return null;
}

/**
 * The project's current SNBT with the cached Housing signature attached: what
 * a giveItem action referencing this item hands out.
 */
export function resolveImportableItemToGive(
    importable: ImportableItem,
    housingUuid: string | null
): ResolvedGive {
    const reason = unsignedGiveReason(importable, housingUuid);
    if (reason !== null) return { ok: false, reason };
    try {
        if (!hasItemClickActions(importable) || housingUuid === null) {
            return { ok: true, item: getItemFromNbt(importable.nbt), signed: false };
        }
        const dependencies = itemDependencyIndexFor(importable);
        const interactData =
            dependencies === undefined
                ? undefined
                : readInteractDataCache(importable, dependencies, housingUuid);
        if (interactData === undefined) {
            return { ok: false, reason: "Import it first to sign its click actions" };
        }
        return {
            ok: true,
            item: itemWithInteractData(importable.nbt, interactData),
            signed: true,
        };
    } catch (error) {
        return { ok: false, reason: `invalid item NBT (${String(error)})` };
    }
}

/** A loose .snbt file as-is: no signature, so click actions never attach. */
export function resolveRawSnbtToGive(path: string): ResolvedGive {
    const snbt = readTextFileOrNull(path);
    if (snbt === null) return { ok: false, reason: `could not read ${path}` };
    if (snbt.trim() === "") return { ok: false, reason: "file is empty" };
    try {
        return { ok: true, item: getItemFromSnbt(snbt), signed: false };
    } catch (error) {
        return { ok: false, reason: `invalid item SNBT (${String(error)})` };
    }
}

/**
 * Give each item into its own empty inventory slot, stopping when the
 * inventory is full. Returns false when another task is running.
 */
export function giveItemsInBackground(
    items: readonly GiveableItem[],
    onDone: (summary: GiveSummary) => void,
    onError: (message: string) => void
): boolean {
    if (TaskManager.isBusy()) return false;
    void runHousingSyncTask("import", (ctx) => giveItems(ctx, items), { disabled: true })
        .then((summary) => {
            if (summary !== undefined) onDone(summary);
        })
        .catch((error: unknown) => {
            onError(error instanceof Error ? error.message : String(error));
        });
    return true;
}

export async function giveItems(
    ctx: TaskContext,
    items: readonly GiveableItem[]
): Promise<GiveSummary> {
    await closeOpenScreen(ctx);
    // `used` covers slots this batch filled: the client inventory catches up a
    // tick after the ack, so a rescan could hand two items the same slot.
    const used = new Set<number>();
    let given = 0;
    for (const { label, item } of items) {
        const slotId = firstEmptyInventorySlot(used);
        if (slotId === null) {
            return { given, total: items.length, stopped: { kind: "full" } };
        }
        const stack = item.getItemStack() as MCItemStack | null;
        if (stack === null) {
            return {
                given,
                total: items.length,
                stopped: { kind: "error", label, message: "empty item stack" },
            };
        }
        try {
            await injectIntoInventorySlot(ctx, slotId, stack);
        } catch (error) {
            return {
                given,
                total: items.length,
                stopped: {
                    kind: "error",
                    label,
                    message: error instanceof Error ? error.message : String(error),
                },
            };
        }
        used.add(slotId);
        given++;
    }
    return { given, total: items.length, stopped: null };
}

function firstEmptyInventorySlot(used: ReadonlySet<number>): number | null {
    for (let slotId = 0; slotId < INVENTORY_SIZE; slotId++) {
        if (used.has(slotId)) continue;
        if (readInventorySlot(slotId, "player").nbt === null) return slotId;
    }
    return null;
}
