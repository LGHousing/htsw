import { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import {
    getCurrentHousingUuid,
    writeKnowledge,
    type ImportableTrustPlan,
} from "../knowledge";
import { importImportableEvent } from "./events/import";
import { importImportableFunction } from "./functions/import";
import { importImportableItem } from "./items/import";
import { importImportableMenu } from "./menus/import";
import { importImportableRegion } from "./regions/import";
import type { ItemRegistry } from "./itemRegistry";

export type ImportTrustOptions = {
    plan?: ImportableTrustPlan;
};

export async function importImportable(
    ctx: TaskContext,
    importable: Importable,
    itemRegistry: ItemRegistry,
    options?: ImportTrustOptions
): Promise<void> {
    if (options?.plan?.wholeImportableTrusted) {
        await maybeWriteKnowledge(ctx, importable);
        ctx.displayMessage(`&7[knowledge] trusted ${importable.type}; skipped import.`);
        return;
    }

    if (importable.type === "FUNCTION") {
        await importImportableFunction(ctx, importable, itemRegistry, options?.plan);
        await maybeWriteKnowledge(ctx, importable);
        return;
    }
    if (importable.type === "EVENT") {
        await importImportableEvent(ctx, importable, itemRegistry, options?.plan);
        await maybeWriteKnowledge(ctx, importable);
        return;
    }
    if (importable.type === "REGION") {
        await importImportableRegion(ctx, importable, itemRegistry, options?.plan);
        await maybeWriteKnowledge(ctx, importable);
        return;
    }
    if (importable.type === "ITEM") {
        // Item handles its own UUID resolution because it needs the UUID
        // for both the existing SNBT cache and the new knowledge cache.
        await importImportableItem(ctx, importable, itemRegistry, options?.plan);
        return;
    }
    if (importable.type === "MENU") {
        await importImportableMenu(ctx, importable, itemRegistry, options?.plan);
        await maybeWriteKnowledge(ctx, importable);
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

