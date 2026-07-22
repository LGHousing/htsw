import type { Importable } from "htsw/types";

import type { ImportableTrustPlan } from "../../importCache";
import type { ActionListApplyResult } from "../../housingSync/actions/apply";
import TaskContext from "../../tasks/context";
import {
    applyImportableCommandPlan,
    commandPlanIsNoOp,
    hydrateImportableCommand,
    planImportableCommand,
    reconstructObservedCommand,
    reconstructPartialCommand,
    scanImportableCommand,
    type CommandImportPlan,
    type CommandRead,
} from "../commands/import";
import {
    applyImportableEventPlan,
    eventPlanIsNoOp,
    hydrateImportableEvent,
    planImportableEvent,
    reconstructObservedEvent,
    reconstructPartialEvent,
    scanImportableEvent,
    type EventImportPlan,
    type EventRead,
} from "../events/import";
import {
    applyImportableFunctionPlan,
    functionPlanIsNoOp,
    hydrateImportableFunction,
    planImportableFunction,
    reconstructObservedFunction,
    reconstructPartialFunction,
    scanImportableFunction,
    type FunctionImportPlan,
    type FunctionRead,
} from "../functions/import";
import {
    applyImportableGroupPlan,
    groupPlanIsNoOp,
    planImportableGroup,
    readImportableGroup,
    type GroupImportPlan,
    type GroupRead,
} from "../groups/import";
import { importableIdentity, importableKey } from "../identity";
import {
    applyImportableItemPlan,
    hydrateImportableItem,
    planImportableItem,
    scanImportableItem,
    type ItemImportPlan,
    type ItemRead,
} from "../items/import";
import {
    applyImportableMenuPlan,
    hydrateImportableMenu,
    menuPlanIsNoOp,
    planImportableMenu,
    scanImportableMenu,
    type MenuImportPlan,
    type MenuRead,
} from "../menus/import";
import {
    applyImportableNpcPlan,
    hydrateImportableNpc,
    npcPlanIsNoOp,
    planImportableNpc,
    scanImportableNpc,
    type NpcImportPlan,
    type NpcRead,
} from "../npcs/import";
import {
    applyImportableRegionPlan,
    hydrateImportableRegion,
    planImportableRegion,
    regionPlanIsNoOp,
    scanImportableRegion,
    type RegionImportPlan,
    type RegionRead,
} from "../regions/import";
import {
    applyImportableTeamPlan,
    planImportableTeam,
    readImportableTeam,
    teamPlanIsNoOp,
    type TeamImportPlan,
    type TeamRead,
} from "../teams/import";
import type { ImportContext } from "./context";

type ImportableOfType<K extends Importable["type"]> = Extract<
    Importable,
    { type: K }
>;

type ImportReader<I, R> =
    | {
          kind: "direct";
          read(
              ctx: TaskContext,
              importable: I,
              context: ImportContext,
              trust: ImportableTrustPlan | undefined
          ): Promise<R>;
      }
    | {
          kind: "staged";
          scan(
              ctx: TaskContext,
              importable: I,
              context: ImportContext,
              trust: ImportableTrustPlan | undefined
          ): Promise<R>;
          hydrate(ctx: TaskContext, read: R): Promise<void>;
      };

export type ImportablePlanDetails =
    | FunctionImportPlan
    | EventImportPlan
    | CommandImportPlan
    | RegionImportPlan
    | MenuImportPlan
    | ItemImportPlan
    | NpcImportPlan
    | TeamImportPlan
    | GroupImportPlan;

type ImporterRecipe<
    K extends Importable["type"],
    R,
    P extends Extract<ImportablePlanDetails, { kind: K }>,
> = {
    type: K;
    reader: ImportReader<ImportableOfType<K>, R>;
    plan(read: R, context: ImportContext): P;
    apply(ctx: TaskContext, plan: P, context: ImportContext): Promise<void>;
    isNoOp(plan: P): boolean;
    reconstructObserved?(plan: P): Importable | null;
    reconstructPartial?(
        plan: P,
        result: ActionListApplyResult | null
    ): Importable | null;
};

type WrappedImportablePlan<P extends ImportablePlanDetails> = {
    readonly kind: P["kind"];
    readonly importable: Importable;
    readonly details: P;
    isNoOp(): boolean;
    apply(ctx: TaskContext, context: ImportContext): Promise<void>;
    reconstructObserved(): Importable | null;
    reconstructPartial(result: ActionListApplyResult | null): Importable | null;
};

export type ImportablePlan = {
    [K in ImportablePlanDetails["kind"]]: WrappedImportablePlan<
        Extract<ImportablePlanDetails, { kind: K }>
    >;
}[ImportablePlanDetails["kind"]];

export type ImportableRead = {
    readonly kind: Importable["type"];
    readonly importable: Importable;
    hydrate(ctx: TaskContext): Promise<void>;
    plan(context: ImportContext): ImportablePlan;
};

type Importer = {
    scan(
        ctx: TaskContext,
        importable: Importable,
        context: ImportContext,
        trust: ImportableTrustPlan | undefined
    ): Promise<ImportableRead>;
};

function defineImporter<
    K extends Importable["type"],
    R,
    P extends Extract<ImportablePlanDetails, { kind: K }>,
>(
    recipe: ImporterRecipe<K, R, P>
): Importer {
    return {
        async scan(ctx, importable, context, trust) {
            if (importable.type !== recipe.type) {
                throw new Error(
                    `Importer for ${recipe.type} cannot read ${importable.type}.`
                );
            }
            const typedImportable = importable as ImportableOfType<K>;
            const reader = recipe.reader;
            const read =
                reader.kind === "direct"
                    ? await reader.read(ctx, typedImportable, context, trust)
                    : await reader.scan(ctx, typedImportable, context, trust);
            return {
                kind: recipe.type,
                importable: typedImportable,
                hydrate:
                    reader.kind === "direct"
                        ? async () => undefined
                        : (hydrateCtx) => reader.hydrate(hydrateCtx, read),
                plan(planContext) {
                    const plan = recipe.plan(read, planContext);
                    return {
                        kind: recipe.type,
                        importable: typedImportable,
                        details: plan,
                        isNoOp: () => recipe.isNoOp(plan),
                        apply: (applyCtx, applyContext) =>
                            recipe.apply(applyCtx, plan, applyContext),
                        reconstructObserved: () =>
                            recipe.reconstructObserved?.(plan) ?? null,
                        reconstructPartial: (result) =>
                            recipe.reconstructPartial?.(plan, result) ?? null,
                    } as ImportablePlan;
                },
            };
        },
    };
}

const IMPORTERS = {
    FUNCTION: defineImporter<"FUNCTION", FunctionRead, FunctionImportPlan>({
        type: "FUNCTION",
        reader: {
            kind: "staged",
            scan: scanImportableFunction,
            hydrate: hydrateImportableFunction,
        },
        plan: planImportableFunction,
        apply: applyImportableFunctionPlan,
        isNoOp: functionPlanIsNoOp,
        reconstructObserved: reconstructObservedFunction,
        reconstructPartial: reconstructPartialFunction,
    }),
    EVENT: defineImporter<"EVENT", EventRead, EventImportPlan>({
        type: "EVENT",
        reader: {
            kind: "staged",
            scan: scanImportableEvent,
            hydrate: hydrateImportableEvent,
        },
        plan: planImportableEvent,
        apply: applyImportableEventPlan,
        isNoOp: eventPlanIsNoOp,
        reconstructObserved: reconstructObservedEvent,
        reconstructPartial: reconstructPartialEvent,
    }),
    COMMAND: defineImporter<"COMMAND", CommandRead, CommandImportPlan>({
        type: "COMMAND",
        reader: {
            kind: "staged",
            scan: scanImportableCommand,
            hydrate: hydrateImportableCommand,
        },
        plan: planImportableCommand,
        apply: applyImportableCommandPlan,
        isNoOp: commandPlanIsNoOp,
        reconstructObserved: reconstructObservedCommand,
        reconstructPartial: reconstructPartialCommand,
    }),
    REGION: defineImporter<"REGION", RegionRead, RegionImportPlan>({
        type: "REGION",
        reader: {
            kind: "staged",
            scan: scanImportableRegion,
            hydrate: hydrateImportableRegion,
        },
        plan: planImportableRegion,
        apply: applyImportableRegionPlan,
        isNoOp: regionPlanIsNoOp,
    }),
    MENU: defineImporter<"MENU", MenuRead, MenuImportPlan>({
        type: "MENU",
        reader: {
            kind: "staged",
            scan: scanImportableMenu,
            hydrate: hydrateImportableMenu,
        },
        plan: planImportableMenu,
        apply: applyImportableMenuPlan,
        isNoOp: menuPlanIsNoOp,
    }),
    ITEM: defineImporter<"ITEM", ItemRead, ItemImportPlan>({
        type: "ITEM",
        reader: {
            kind: "staged",
            scan: scanImportableItem,
            hydrate: hydrateImportableItem,
        },
        plan: planImportableItem,
        apply: applyImportableItemPlan,
        isNoOp: () => false,
    }),
    NPC: defineImporter<"NPC", NpcRead, NpcImportPlan>({
        type: "NPC",
        reader: {
            kind: "staged",
            scan: scanImportableNpc,
            hydrate: hydrateImportableNpc,
        },
        plan: planImportableNpc,
        apply: applyImportableNpcPlan,
        isNoOp: npcPlanIsNoOp,
    }),
    TEAM: defineImporter<"TEAM", TeamRead, TeamImportPlan>({
        type: "TEAM",
        reader: {
            kind: "direct",
            read: (ctx, importable, _context, trust) =>
                readImportableTeam(ctx, importable, trust),
        },
        plan: planImportableTeam,
        apply: applyImportableTeamPlan,
        isNoOp: teamPlanIsNoOp,
    }),
    GROUP: defineImporter<"GROUP", GroupRead, GroupImportPlan>({
        type: "GROUP",
        reader: {
            kind: "direct",
            read: (ctx, importable, _context, trust) =>
                readImportableGroup(ctx, importable, trust),
        },
        plan: planImportableGroup,
        apply: applyImportableGroupPlan,
        isNoOp: groupPlanIsNoOp,
    }),
} satisfies Record<Importable["type"], Importer>;

export function scanImportable(
    ctx: TaskContext,
    importable: Importable,
    context: ImportContext
): Promise<ImportableRead> {
    const trust = context.actions.trust.importables.get(
        importableKey(importable.type, importableIdentity(importable))
    );
    return IMPORTERS[importable.type].scan(ctx, importable, context, trust);
}

export async function readImportablePlan(
    ctx: TaskContext,
    importable: Importable,
    context: ImportContext
): Promise<ImportablePlan> {
    const read = await scanImportable(ctx, importable, context);
    await read.hydrate(ctx);
    return read.plan(context);
}
