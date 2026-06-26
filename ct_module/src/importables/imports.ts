import { Diagnostic, type ImportablesParseResult } from "htsw";
import { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import {
    importableIdentity,
    importableKey,
    type ImportableTrustPlan,
    type TrustPlan,
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
    regionPlanIsNoOp,
    type RegionImportPlan,
} from "./regions/import";
import type { ItemRegistry } from "./itemRegistry";
import type { ImportEventHandler } from "../housingSync/importEvents";
import type { ItemCaptureRegistry } from "../housingSync/itemCapture";

export const IMPLEMENTED_IMPORTABLE_TYPES = [
    "FUNCTION",
    "EVENT",
    "REGION",
    "ITEM",
    "MENU",
] as const;

export type ImportSession = {
    parsed: ImportablesParseResult;
    items: ItemRegistry;
    housingUuid: string;
    trust: TrustPlan;
    events: ImportEventHandler | undefined;
    itemCaptures?: ItemCaptureRegistry;
};

function trustFor(
    session: ImportSession,
    importable: Importable
): ImportableTrustPlan | undefined {
    return session.trust.importables.get(
        importableKey(importable.type, importableIdentity(importable))
    );
}

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
    session: ImportSession
): Promise<ImportablePlan> {
    const trust = trustFor(session, importable);
    switch (importable.type) {
        case "FUNCTION":
            return prereadImportableFunction(
                ctx,
                importable,
                session,
                trust,
            );
        case "EVENT":
            return prereadImportableEvent(
                ctx,
                importable,
                session,
                trust,
            );
        case "REGION":
            return prereadImportableRegion(
                ctx,
                importable,
                session,
                trust,
            );
        case "MENU":
            return prereadImportableMenu(
                ctx,
                importable,
                session,
                trust,
            );
        case "ITEM":
            return prereadImportableItem(
                ctx,
                importable,
                session,
                trust
            );
        case "TEAM":
        case "GROUP":
        case "COMMAND":
        case "HOUSE_NAME":
            throw Diagnostic.error(`${importable.type} imports are not implemented in the ChatTriggers module.`);
        default: {
            const _exhaustiveCheck: never = importable;
            return _exhaustiveCheck;
        }
    }
}

export async function applyImportablePlan(
    ctx: TaskContext,
    plan: ImportablePlan,
    session: ImportSession
): Promise<void> {
    // The importer cache write for a freshly-applied importable is owned by the
    // orchestrator (importSession), which is this function's only caller and
    // the one place that knows an importable reached a known-good state. ITEM
    // is the exception: it manages its own per-NBT cache inside its apply.
    switch (plan.kind) {
        case "FUNCTION":
            await applyImportableFunctionPlan(ctx, plan, session);
            return;
        case "EVENT":
            await applyImportableEventPlan(ctx, plan, session);
            return;
        case "REGION":
            await applyImportableRegionPlan(ctx, plan, session);
            return;
        case "MENU":
            await applyImportableMenuPlan(ctx, plan, session);
            return;
        case "ITEM":
            await applyImportableItemPlan(ctx, plan, session);
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
            return regionPlanIsNoOp(plan);
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
