import { Diagnostic } from "htsw";
import { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import {
    getCurrentHousingUuid,
    writeImportableCache,
    type ImportableTrustPlan,
} from "../importCache";
import {
    applyImportableEventPlan,
    prereadImportableEvent,
    type EventImportPlan,
} from "./events/import";
import {
    applyImportableFunctionPlan,
    prereadImportableFunction,
    type FunctionImportPlan,
} from "./functions/import";
import {
    applyImportableItemPlan,
    prereadImportableItem,
    type ItemImportPlan,
} from "./items/import";
import {
    applyImportableMenuPlan,
    prereadImportableMenu,
    type MenuImportPlan,
} from "./menus/import";
import {
    applyImportableRegionPlan,
    prereadImportableRegion,
    type RegionImportPlan,
} from "./regions/import";
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

/**
 * Discriminated union of per-importable plans produced by `prereadImportable`
 * and consumed by `applyImportablePlan`. FUNCTION / EVENT / REGION carry a
 * computed action-list diff so the apply pass can run without re-reading;
 * ITEM / MENU are placeholder plans that defer all work to the apply pass.
 */
export type ImportablePlan =
    | FunctionImportPlan
    | EventImportPlan
    | RegionImportPlan
    | ItemImportPlan
    | MenuImportPlan;

export async function prereadImportable(
    ctx: TaskContext,
    importable: Importable,
    itemRegistry: ItemRegistry,
    options?: ImportTrustOptions
): Promise<ImportablePlan> {
    switch (importable.type) {
        case "FUNCTION":
            return prereadImportableFunction(
                ctx,
                importable,
                itemRegistry,
                options?.plan,
                options?.events
            );
        case "EVENT":
            return prereadImportableEvent(
                ctx,
                importable,
                itemRegistry,
                options?.plan,
                options?.events
            );
        case "REGION":
            return prereadImportableRegion(
                ctx,
                importable,
                itemRegistry,
                options?.plan,
                options?.events
            );
        case "MENU":
            return prereadImportableMenu(
                ctx,
                importable,
                itemRegistry,
                options?.plan,
                options?.events
            );
        case "ITEM":
            return prereadImportableItem(
                ctx,
                importable,
                itemRegistry,
                options?.plan,
                options?.housingUuid,
                options?.events
            );
        case "NPC":
            throw Diagnostic.error("NPC imports are not implemented in the ChatTriggers module.");
        default: {
            const _exhaustiveCheck: never = importable;
            return _exhaustiveCheck;
        }
    }
}

export async function applyImportablePlan(
    ctx: TaskContext,
    plan: ImportablePlan,
    itemRegistry: ItemRegistry,
    options?: ImportTrustOptions
): Promise<void> {
    switch (plan.kind) {
        case "FUNCTION":
            await applyImportableFunctionPlan(ctx, plan, itemRegistry, options?.events);
            await maybeWriteImportCache(ctx, plan.importable, options?.housingUuid);
            return;
        case "EVENT":
            await applyImportableEventPlan(ctx, plan, itemRegistry, options?.events);
            await maybeWriteImportCache(ctx, plan.importable, options?.housingUuid);
            return;
        case "REGION":
            await applyImportableRegionPlan(ctx, plan, itemRegistry, options?.events);
            await maybeWriteImportCache(ctx, plan.importable, options?.housingUuid);
            return;
        case "MENU":
            await applyImportableMenuPlan(ctx, plan, itemRegistry, options?.events);
            await maybeWriteImportCache(ctx, plan.importable, options?.housingUuid);
            return;
        case "ITEM":
            // Items manage their own per-NBT cache; skip the generic write.
            await applyImportableItemPlan(ctx, plan, itemRegistry, options?.events);
            return;
        default: {
            const _exhaustiveCheck: never = plan;
            return _exhaustiveCheck;
        }
    }
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
