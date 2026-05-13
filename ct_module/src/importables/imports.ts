import { Diagnostic } from "htsw";
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
import type { ActionListProgressFields } from "../importer/progress/types";

export type ImportTrustOptions = {
    plan?: ImportableTrustPlan;
    onActionListProgress?: (progress: ActionListProgressFields) => void;
    /**
     * Session-level housing UUID. When provided, `maybeWriteKnowledge`
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
        await maybeWriteKnowledge(ctx, importable, options?.housingUuid);
        ctx.displayMessage(`&7[knowledge] trusted ${importable.type}; skipped import.`);
        return;
    }

    switch (importable.type) {
        case "FUNCTION":
            await importImportableFunction(
                ctx,
                importable,
                itemRegistry,
                options?.plan,
                options?.onActionListProgress
            );
            await maybeWriteKnowledge(ctx, importable, options?.housingUuid);
            return;
        case "EVENT":
            await importImportableEvent(
                ctx,
                importable,
                itemRegistry,
                options?.plan,
                options?.onActionListProgress
            );
            await maybeWriteKnowledge(ctx, importable, options?.housingUuid);
            return;
        case "REGION":
            await importImportableRegion(
                ctx,
                importable,
                itemRegistry,
                options?.plan,
                options?.onActionListProgress
            );
            await maybeWriteKnowledge(ctx, importable, options?.housingUuid);
            return;
        case "ITEM":
            await importImportableItem(
                ctx,
                importable,
                itemRegistry,
                options?.plan,
                options?.housingUuid,
                options?.onActionListProgress
            );
            return;
        case "MENU":
            await importImportableMenu(
                ctx,
                importable,
                itemRegistry,
                options?.plan,
                options?.onActionListProgress
            );
            await maybeWriteKnowledge(ctx, importable, options?.housingUuid);
            return;
        case "NPC":
            throw Diagnostic.error("NPC imports are not implemented in the ChatTriggers module.");
        default: {
            const _exhaustiveCheck: never = importable;
            return _exhaustiveCheck;
        }
    }
}

/**
 * Resolve the housing UUID and persist a knowledge entry for the just-
 * imported importable. Best-effort: any failure (no /wtfmap reply,
 * filesystem error) is logged and swallowed — the cache is a hint, not
 * a contract, so it must not abort a successful import.
 */
async function maybeWriteKnowledge(
    ctx: TaskContext,
    importable: Importable,
    cachedUuid?: string
): Promise<void> {
    try {
        const housingUuid = cachedUuid ?? (await getCurrentHousingUuid(ctx));
        writeKnowledge(ctx, housingUuid, importable, "importer");
    } catch (error) {
        ctx.displayMessage(
            `&7[knowledge] &eSkipped cache write for ${importable.type}: ${error}`
        );
    }
}
