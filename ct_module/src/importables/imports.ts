import {
    Action,
    Importable,
    ImportableEvent,
    ImportableFunction,
    ImportableItem,
    ImportableRegion,
    Pos,
} from "htsw/types";

import { syncActionList } from "../importer/actions";
import TaskContext from "../tasks/context";
import { clickGoBack, waitForMenu, waitForUnformattedMessage } from "../importer/helpers";
import { removedFormatting } from "../utils/helpers";
import { getItemFromNbt } from "../utils/nbt";
import {
    C09PacketHeldItemChange,
    C10PacketCreativeInventoryAction,
} from "../utils/packets";
import { getCurrentHousingUuid, importableHash, writeKnowledge } from "../knowledge";
import {
    ensureFunctionExists,
    ensureFunctionNamesExist,
    openFunctionSettings,
    setAutomaticExecutionTicksIfNeeded,
    setFunctionIconIfNeeded,
} from "./functions";
import type { ItemRegistry } from "./itemRegistry";

export async function importImportable(
    ctx: TaskContext,
    importable: Importable,
    itemRegistry: ItemRegistry
): Promise<void> {
    if (importable.type === "FUNCTION") {
        await importImportableFunction(ctx, importable, itemRegistry);
        await maybeWriteKnowledge(ctx, importable);
        return;
    }
    if (importable.type === "EVENT") {
        await importImportableEvent(ctx, importable, itemRegistry);
        await maybeWriteKnowledge(ctx, importable);
        return;
    }
    if (importable.type === "REGION") {
        await importImportableRegion(ctx, importable, itemRegistry);
        await maybeWriteKnowledge(ctx, importable);
        return;
    }
    if (importable.type === "ITEM") {
        // Item handles its own UUID resolution because it needs the UUID
        // for both the existing SNBT cache and the new knowledge cache.
        await importImportableItem(ctx, importable, itemRegistry);
        return;
    }
    // TODO add the others idk and remove the ts ignore
    // @ts-ignore
    const _exhaustiveCheck: never = importable;
}

/**
 * Resolve the housing UUID and persist a knowledge entry for the just-
 * imported importable. Best-effort: any failure (no /wtfmap reply,
 * filesystem error) is logged and swallowed — the cache is a hint, not
 * a contract, so it must not abort a successful import.
 */
async function maybeWriteKnowledge(
    ctx: TaskContext,
    importable: Importable
): Promise<void> {
    try {
        const housingUuid = await getCurrentHousingUuid(ctx);
        writeKnowledge(ctx, housingUuid, importable, "importer");
    } catch (error) {
        ctx.displayMessage(
            `&7[knowledge] &eSkipped cache write for ${importable.type}: ${error}`
        );
    }
}

async function importImportableFunction(
    ctx: TaskContext,
    importable: ImportableFunction,
    itemRegistry: ItemRegistry
): Promise<void> {
    await ensureReferencedFunctionsExist(ctx, importable);
    await ensureFunctionExists(ctx, importable.name);

    // we have a function!!! open!!
    await syncActionList(ctx, importable.actions, { itemRegistry });

    if (importable.repeatTicks || importable.icon) {
        await clickGoBack(ctx);

        await openFunctionSettings(ctx, importable.name);
        if (importable.icon) {
            await setFunctionIconIfNeeded(ctx, importable.icon);
        }
        if (importable.repeatTicks) {
            await setAutomaticExecutionTicksIfNeeded(ctx, importable.repeatTicks);
        }
        await clickGoBack(ctx);
    }
}

async function importImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent,
    itemRegistry: ItemRegistry
): Promise<void> {
    await ensureReferencedFunctionsExist(ctx, importable);

    ctx.runCommand(`/eventactions`);
    await waitForMenu(ctx);

    ctx.getItemSlot(importable.event).click();
    await waitForMenu(ctx);

    // we have an event!!! open!!! :)
    await syncActionList(ctx, importable.actions, { itemRegistry });
}

async function importImportableRegion(
    ctx: TaskContext,
    importable: ImportableRegion,
    itemRegistry: ItemRegistry
): Promise<void> {
    await ensureReferencedFunctionsExist(ctx, importable);

    const setPos = async (pos: Pos, corner: "A" | "B") => {
        ctx.runCommand(`/tp ${pos.x} ${pos.y} ${pos.z}`);
        await waitForUnformattedMessage(
            ctx,
            `Teleporting you to ${pos.x}, ${pos.y}, ${pos.z}.`
        );

        ctx.runCommand(`//pos${corner}`);
        await waitForUnformattedMessage(
            ctx,
            `Position ${corner} set to ${pos.x}, ${pos.y}, ${pos.z}.`
        );
    };

    await setPos(importable.bounds.from, "A");
    await setPos(importable.bounds.to, "B");

    ctx.runCommand(`/region edit ${importable.name}`);

    const alreadyExists = await ctx.withTimeout(
        Promise.race([
            waitForMenu(ctx).then(() => true),
            ctx
                .waitFor(
                    "message",
                    (message) =>
                        removedFormatting(message) ===
                        "Could not find a region with that name!"
                )
                .then(() => false),
        ]),
        "Waiting for region to open"
    );

    if (!alreadyExists) {
        ctx.runCommand(`/region create ${importable.name}`);
        await waitForUnformattedMessage(ctx, `Created region ${importable.name}!`);

        ctx.runCommand(`/region edit ${importable.name}`);
        await waitForMenu(ctx);
    } else {
        ctx.getItemSlot("Move Region").click();
        await waitForUnformattedMessage(ctx, "Updated region to your current selection!");

        ctx.runCommand(`/region edit ${importable.name}`);
        await waitForMenu(ctx);
    }

    if (importable.onEnterActions) {
        ctx.getItemSlot("Entry Actions").click();
        await waitForMenu(ctx);

        await syncActionList(ctx, importable.onEnterActions, { itemRegistry });

        if (importable.onExitActions) {
            await clickGoBack(ctx);
        }
    }

    if (importable.onExitActions) {
        ctx.getItemSlot("Exit Actions").click();
        await waitForMenu(ctx);

        await syncActionList(ctx, importable.onExitActions, { itemRegistry });
    }
}

async function importImportableItem(
    ctx: TaskContext,
    importable: ImportableItem,
    itemRegistry: ItemRegistry
): Promise<void> {
    if (!importable.leftClickActions && !importable.rightClickActions) return;

    await ensureReferencedFunctionsExist(ctx, importable);

    const uuid = await getCurrentHousingUuid(ctx);
    const hash = importableHash(importable);
    if (FileLib.exists(`./htsw/.cache/${uuid}/items/${hash}.snbt`)) {
        // SNBT cache hit — actions already in sync. Refresh the knowledge
        // cache too so future trust-mode has an entry even when no GUI
        // round trip happened on this run.
        try {
            writeKnowledge(ctx, uuid, importable, "importer");
        } catch {
            // best-effort
        }
        return;
    }

    const item = getItemFromNbt(importable.nbt);

    Client.sendPacket(new C10PacketCreativeInventoryAction(36, item.getItemStack()));
    if (Player.getPlayer().field_71071_by.field_70461_c !== 0) {
        Client.sendPacket(new C09PacketHeldItemChange(0));
        Player.getPlayer().field_71071_by.field_70461_c = 0;
    }
    await ctx.sleep(1000);

    ctx.runCommand("/edit");
    await waitForMenu(ctx);

    ctx.getItemSlot("Edit Actions").click();
    await waitForMenu(ctx);

    if (importable.leftClickActions) {
        ctx.getItemSlot("Left Click Actions").click();
        await waitForMenu(ctx);

        await syncActionList(ctx, importable.leftClickActions, { itemRegistry });

        if (importable.rightClickActions) {
            await clickGoBack(ctx);
        }
    }

    if (importable.rightClickActions) {
        ctx.getItemSlot("Right Click Actions").click();
        await waitForMenu(ctx);

        await syncActionList(ctx, importable.rightClickActions, { itemRegistry });
    }

    await ctx.sleep(1000);

    const snbt = Player.getInventory()?.getStackInSlot(0)?.getRawNBT();
    if (!snbt) throw Error("Why don't we have the item?");

    FileLib.write(`./htsw/.cache/${uuid}/items/${hash}.snbt`, snbt, true);
    try {
        writeKnowledge(ctx, uuid, importable, "importer");
    } catch (error) {
        ctx.displayMessage(`&7[knowledge] &eSkipped cache write for ITEM: ${error}`);
    }
}

async function ensureReferencedFunctionsExist(
    ctx: TaskContext,
    importable: Importable
): Promise<void> {
    await ensureFunctionNamesExist(ctx, collectReferencedFunctionNames(importable));
}

function collectReferencedFunctionNames(importable: Importable): string[] {
    const names: string[] = [];

    if (importable.type === "FUNCTION") {
        collectActionFunctionNames(importable.actions, names);
    } else if (importable.type === "EVENT") {
        collectActionFunctionNames(importable.actions, names);
    } else if (importable.type === "REGION") {
        collectActionFunctionNames(importable.onEnterActions, names);
        collectActionFunctionNames(importable.onExitActions, names);
    } else if (importable.type === "ITEM") {
        collectActionFunctionNames(importable.leftClickActions, names);
        collectActionFunctionNames(importable.rightClickActions, names);
    }

    return names;
}

function collectActionFunctionNames(
    actions: readonly Action[] | undefined,
    names: string[]
): void {
    if (!actions) return;

    for (const action of actions) {
        if (action.type === "FUNCTION") {
            names.push(action.function);
        } else if (action.type === "CONDITIONAL") {
            collectActionFunctionNames(action.ifActions, names);
            collectActionFunctionNames(action.elseActions, names);
        } else if (action.type === "RANDOM") {
            collectActionFunctionNames(action.actions, names);
        }
    }
}
