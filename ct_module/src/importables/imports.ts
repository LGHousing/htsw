import { type ImportablesParseResult } from "htsw";
import { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { type ImportableTrustPlan, type TrustPlan } from "../importCache";
import { importableIdentity, importableKey } from "./identity";
import {
    applyImportableEventPlan,
    eventPlanIsNoOp,
    prereadImportableEvent,
    reconstructObservedEvent,
    reconstructPartialEvent,
    type EventImportPlan,
} from "./events/import";
import {
    applyImportableCommandPlan,
    commandPlanIsNoOp,
    prereadImportableCommand,
    reconstructObservedCommand,
    reconstructPartialCommand,
    type CommandImportPlan,
} from "./commands/import";
import {
    applyImportableFunctionPlan,
    functionPlanIsNoOp,
    prereadImportableFunction,
    reconstructObservedFunction,
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
    applyImportableNpcPlan,
    npcPlanIsNoOp,
    prereadImportableNpc,
    type NpcImportPlan,
} from "./npcs/import";
import {
    applyImportableRegionPlan,
    prereadImportableRegion,
    regionPlanIsNoOp,
    type RegionImportPlan,
} from "./regions/import";
import {
    applyImportableTeamPlan,
    prereadImportableTeam,
    teamPlanIsNoOp,
    type TeamImportPlan,
} from "./teams/import";
import {
    applyImportableGroupPlan,
    groupPlanIsNoOp,
    prereadImportableGroup,
    type GroupImportPlan,
} from "./groups/import";
import type { ItemRegistry } from "./itemRegistry";
import type { SyncEventHandler } from "../housingSync/syncEvents";
import type { ItemCaptureRegistry } from "../housingSync/itemCapture";
import type { NpcLookupCache } from "./npcs/listNpcs";
import type { ActionListApplyResult } from "../housingSync/actions/apply";
import type { ImportConflict } from "./importConflicts";
import type { ItemDiffContext } from "../housingSync/actions/diff/itemDiffContext";
import type { ItemDependencyIndex } from "./itemDependencyIndex";
import type { ItemFieldObservationRecorder } from "../housingSync/itemFieldObservations";

export type ImportSession = {
    parsed: ImportablesParseResult;
    items: ItemRegistry;
    housingUuid: string;
    trust: TrustPlan;
    conflicts: ImportConflict[];
    events: SyncEventHandler | undefined;
    actionItemRead:
        | { mode: "sync" }
        | { mode: "verify"; captures: ItemCaptureRegistry };
    itemDiff?: ItemDiffContext;
    itemDependencies?: ItemDependencyIndex;
    itemFieldObservations?: ItemFieldObservationRecorder;
    npcLookup: NpcLookupCache;
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
 * computed action-list diff so the apply pass can run without re-reading.
 * ITEM / MENU are placeholder plans that defer all work to the apply pass.
 */
export type ImportablePlan =
    | FunctionImportPlan
    | CommandImportPlan
    | EventImportPlan
    | RegionImportPlan
    | NpcImportPlan
    | ItemImportPlan
    | MenuImportPlan
    | TeamImportPlan
    | GroupImportPlan;

export async function prereadImportable(
    ctx: TaskContext,
    importable: Importable,
    session: ImportSession
): Promise<ImportablePlan> {
    const trust = trustFor(session, importable);
    switch (importable.type) {
        case "FUNCTION":
            return prereadImportableFunction(ctx, importable, session, trust);
        case "EVENT":
            return prereadImportableEvent(ctx, importable, session, trust);
        case "COMMAND":
            return prereadImportableCommand(ctx, importable, session, trust);
        case "REGION":
            return prereadImportableRegion(ctx, importable, session, trust);
        case "MENU":
            return prereadImportableMenu(ctx, importable, session, trust);
        case "ITEM":
            return prereadImportableItem(ctx, importable, session, trust);
        case "NPC":
            return prereadImportableNpc(ctx, importable, session, trust);
        case "TEAM":
            return prereadImportableTeam(ctx, importable, session, trust);
        case "GROUP":
            return prereadImportableGroup(ctx, importable, session, trust);
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
        case "COMMAND":
            await applyImportableCommandPlan(ctx, plan, session);
            return;
        case "REGION":
            await applyImportableRegionPlan(ctx, plan, session);
            return;
        case "NPC":
            await applyImportableNpcPlan(ctx, plan, session);
            return;
        case "MENU":
            await applyImportableMenuPlan(ctx, plan, session);
            return;
        case "ITEM":
            await applyImportableItemPlan(ctx, plan, session);
            return;
        case "TEAM":
            await applyImportableTeamPlan(ctx, plan, session);
            return;
        case "GROUP":
            await applyImportableGroupPlan(ctx, plan, session);
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
        case "COMMAND":
            return commandPlanIsNoOp(plan);
        case "REGION":
            return regionPlanIsNoOp(plan);
        case "NPC":
            return npcPlanIsNoOp(plan);
        case "TEAM":
            return teamPlanIsNoOp(plan);
        case "GROUP":
            return groupPlanIsNoOp(plan);
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
export function reconstructPartialImportable(
    plan: ImportablePlan,
    result: ActionListApplyResult | null
): Importable | null {
    switch (plan.kind) {
        case "FUNCTION":
            return reconstructPartialFunction(plan, result);
        case "EVENT":
            return reconstructPartialEvent(plan, result);
        case "COMMAND":
            return reconstructPartialCommand(plan, result);
        case "REGION":
        case "NPC":
        case "MENU":
        case "ITEM":
        case "TEAM":
        case "GROUP":
            return null;
        default: {
            const _exhaustiveCheck: never = plan;
            return _exhaustiveCheck;
        }
    }
}

/**
 * Rebuild the importable from the state its pre-read observed, for a plan that
 * was read but never applied (the session aborted first). Same conservative
 * type coverage and settings-dropping as the partial write above.
 */
export function reconstructObservedImportable(plan: ImportablePlan): Importable | null {
    switch (plan.kind) {
        case "FUNCTION":
            return reconstructObservedFunction(plan);
        case "EVENT":
            return reconstructObservedEvent(plan);
        case "COMMAND":
            return reconstructObservedCommand(plan);
        case "REGION":
        case "NPC":
        case "MENU":
        case "ITEM":
        case "TEAM":
        case "GROUP":
            return null;
        default: {
            const _exhaustiveCheck: never = plan;
            return _exhaustiveCheck;
        }
    }
}
