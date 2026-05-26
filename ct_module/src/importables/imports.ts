import { Diagnostic } from "htsw";
import { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import {
    getCurrentHousingUuid,
    writeImportableCache,
    type ImportableTrustPlan,
} from "../importCache";
import { importImportableEvent } from "./events/import";
import { importImportableFunction } from "./functions/import";
import { importImportableItem } from "./items/import";
import { importImportableMenu } from "./menus/import";
import { importImportableRegion } from "./regions/import";
import type { ItemRegistry } from "./itemRegistry";
import type { ImportEventHandler } from "../importer/importEvents";

export type ImportTrustOptions = {
    plan?: ImportableTrustPlan;
    events?: ImportEventHandler;
    /**
     * Session-level housing UUID. When provided, `maybeWriteImportCache`
     * skips the `/wtfmap` round trip — the session already resolved the
     * UUID once at the top of the import. Avoids N extra `/wtfmap` calls
     * for an N-importable run AND removes a likely silent-failure path
     * (chat-busy timeouts on per-importable lookups).
     */
    housingUuid?: string;
};

export async function importImportable(
    ctx: TaskContext,
    importable: Importable,
    itemRegistry: ItemRegistry,
    options?: ImportTrustOptions
): Promise<void> {
    if (options?.plan?.wholeImportableTrusted) {
        await maybeWriteImportCache(ctx, importable, options?.housingUuid);
        ctx.displayMessage(`&7[knowledge] trusted ${importable.type}; skipped import.`);
        return;
    }

    switch (importable.type) {
        case "FUNCTION":
            await importImportableFunction(ctx, importable, itemRegistry, options?.plan, options?.events);
            break;
        case "EVENT":
            await importImportableEvent(ctx, importable, itemRegistry, options?.plan, options?.events);
            break;
        case "REGION":
            await importImportableRegion(ctx, importable, itemRegistry, options?.plan, options?.events);
            break;
        case "MENU":
            await importImportableMenu(ctx, importable, itemRegistry, options?.plan, options?.events);
            break;
        case "ITEM":
            // Items manage their own per-NBT cache; skip the generic write.
            await importImportableItem(
                ctx, importable, itemRegistry,
                options?.plan, options?.housingUuid, options?.events
            );
            return;
        case "NPC":
            throw Diagnostic.error("NPC imports are not implemented in the ChatTriggers module.");
        default: {
            const _exhaustiveCheck: never = importable;
            return _exhaustiveCheck;
        }
    }
    await maybeWriteImportCache(ctx, importable, options?.housingUuid);
}

/**
 * Resolve the housing UUID and persist a cache entry for the just-
 * imported importable. Best-effort: any failure (no /wtfmap reply,
 * filesystem error) is logged and swallowed — the cache is a hint, not
 * a contract, so it must not abort a successful import.
 */
async function maybeWriteImportCache(
    ctx: TaskContext,
    importable: Importable,
    cachedUuid?: string
): Promise<void> {
    try {
        const housingUuid = cachedUuid ?? (await getCurrentHousingUuid(ctx));
        writeImportableCache(ctx, housingUuid, importable, "importer");
    } catch (error) {
        ctx.displayMessage(
            `&7[knowledge] &eSkipped cache write for ${importable.type}: ${error}`
        );
    }
}
