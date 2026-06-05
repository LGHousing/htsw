import { Diagnostic } from "htsw";
import { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import {
    type ImportableTrustPlan,
} from "../importCache";
import {
    applyImportableEventPlan,
    eventPlanIsNoOp,
    prereadImportableEvent,
    reconstructPartialEvent,
    type EventImportPlan,
} from "./events/import";
import {
    applyImportableFunctionPlan,
    functionPlanIsNoOp,
    prereadImportableFunction,
    reconstructPartialFunction,
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
import type { ImportEventHandler } from "../housingSync/importEvents";

export type ImportTrustOptions = {
    plan?: ImportableTrustPlan;
    events?: ImportEventHandler;
    /**
     * Session-level housing UUID, resolved once at the top of the import.
     * Handed to ITEM preread (it needs the UUID for its per-NBT cache) so it
     * skips a per-importable `/wtfmap` round trip — avoiding N extra lookups
     * for an N-importable run AND a chat-busy silent-failure path.
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
    // The importer cache write for a freshly-applied importable is owned by the
    // orchestrator (importSession), which is this function's only caller and
    // the one place that knows an importable reached a known-good state. ITEM
    // is the exception: it manages its own per-NBT cache inside its apply.
    switch (plan.kind) {
        case "FUNCTION":
            await applyImportableFunctionPlan(ctx, plan, itemRegistry, options?.events);
            return;
        case "EVENT":
            await applyImportableEventPlan(ctx, plan, itemRegistry, options?.events);
            return;
        case "REGION":
            await applyImportableRegionPlan(ctx, plan, itemRegistry, options?.events);
            return;
        case "MENU":
            await applyImportableMenuPlan(ctx, plan, itemRegistry, options?.events);
            return;
        case "ITEM":
            await applyImportableItemPlan(ctx, plan, itemRegistry, options?.events);
            return;
        default: {
            const _exhaustiveCheck: never = plan;
            return _exhaustiveCheck;
        }
    }
}

/**
 * True when applying this plan would change nothing, so the importable can be
 * marked done right after the read pass and skip the apply pass entirely. Only
 * EVENT and FUNCTION can be judged this early — their apply work is the action
 * diff already computed during preread. REGION, MENU and ITEM always have real
 * work left in the apply pass.
 */
export function planIsNoOp(plan: ImportablePlan): boolean {
    switch (plan.kind) {
        case "FUNCTION":
            return functionPlanIsNoOp(plan);
        case "EVENT":
            return eventPlanIsNoOp(plan);
        case "REGION":
        case "MENU":
        case "ITEM":
            return false;
        default: {
            const _exhaustiveCheck: never = plan;
            return _exhaustiveCheck;
        }
    }
}

/**
 * Rebuild the importable from its live snapshot for a partial-failure cache
 * write, or null when it can't be safely persisted. FUNCTION/EVENT only;
 * icon/ticks are dropped so a retry re-applies settings instead of trusting
 * maybe-unwritten values.
 */
export function reconstructPartialImportable(plan: ImportablePlan): Importable | null {
    switch (plan.kind) {
        case "FUNCTION":
            return reconstructPartialFunction(plan);
        case "EVENT":
            return reconstructPartialEvent(plan);
        case "REGION":
        case "MENU":
        case "ITEM":
            return null;
        default: {
            const _exhaustiveCheck: never = plan;
            return _exhaustiveCheck;
        }
    }
}
