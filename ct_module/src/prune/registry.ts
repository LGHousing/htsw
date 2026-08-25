import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { listAllCommandNames } from "../importables/commands/listCommands";
import { listAllFunctionNames } from "../importables/functions/listFunctions";
import { listAllGroupNames, deleteGroup } from "../importables/groups/listGroups";
import { listAllMenuNames } from "../importables/menus/listMenus";
import { listAllNpcs } from "../importables/npcs/listNpcs";
import { listAllRegionNames } from "../importables/regions/listRegions";
import { listAllTeamNames, deleteTeam } from "../importables/teams/listTeams";
import { knownEventNames } from "../importables/events/listEvents";
import { npcPosIdentity } from "../importables/identity";

/**
 * How an undeclared house object stops existing. `clearActions` is for events:
 * Housing has all eighteen in every house and deletes none of them, so the most
 * an armed manifest can say about an undeclared one is that it runs nothing.
 * `report` is for types with no removal path yet — named in the plan, never
 * acted on.
 */
export type PruneMethod = "delete" | "clearActions" | "report";

export type PruneType = {
    type: Importable["type"];
    /** Singular, lowercase, for chat and plan lines. */
    label: string;
    /** Plural, lowercase. */
    pluralLabel: string;
    method: PruneMethod;
    /** Identities present in the live house, in list order. */
    list: (ctx: TaskContext) => Promise<string[]>;
    /** Removes one object. Absent for the methods with no per-identity call. */
    remove?: (ctx: TaskContext, identity: string) => Promise<void>;
    /** Identities Housing will not delete. Matched case-insensitively. */
    protectedIdentities?: readonly string[];
};

// Housing creates /stuck and /clear in every house and offers no way to remove
// them.
const BUILT_IN_COMMANDS = ["stuck", "clear"];

/**
 * Which importable types a prune can act on. Total over `Importable["type"]` via
 * `satisfies`, so a new importable type is a compile error here until it
 * declares how it is pruned or opts out with `null`.
 *
 * ITEM opts out: an item has no house presence of its own — it exists only where
 * an action or menu references it — so there is nothing to enumerate or delete.
 */
const PRUNE_TYPES = {
    FUNCTION: {
        type: "FUNCTION",
        label: "function",
        pluralLabel: "functions",
        method: "delete",
        list: listAllFunctionNames,
        remove: async (ctx, identity) => {
            await ctx.runCommand(`/function delete ${identity}`);
        },
    },
    MENU: {
        type: "MENU",
        label: "menu",
        pluralLabel: "menus",
        method: "delete",
        list: listAllMenuNames,
        remove: async (ctx, identity) => {
            await ctx.runCommand(`/menu delete ${identity}`);
        },
    },
    REGION: {
        type: "REGION",
        label: "region",
        pluralLabel: "regions",
        method: "delete",
        list: listAllRegionNames,
        remove: async (ctx, identity) => {
            await ctx.runCommand(`/region delete ${identity}`);
        },
    },
    COMMAND: {
        type: "COMMAND",
        label: "command",
        pluralLabel: "commands",
        method: "delete",
        list: listAllCommandNames,
        remove: async (ctx, identity) => {
            await ctx.runCommand(`/command delete ${identity}`);
        },
        protectedIdentities: BUILT_IN_COMMANDS,
    },
    EVENT: {
        type: "EVENT",
        label: "event",
        pluralLabel: "events",
        method: "clearActions",
        list: async () => knownEventNames(),
    },
    TEAM: {
        type: "TEAM",
        label: "team",
        pluralLabel: "teams",
        method: "delete",
        list: listAllTeamNames,
        remove: deleteTeam,
    },
    GROUP: {
        type: "GROUP",
        label: "group",
        pluralLabel: "groups",
        method: "delete",
        list: listAllGroupNames,
        remove: deleteGroup,
    },
    NPC: {
        // Position-keyed, and no delete walker exists yet.
        type: "NPC",
        label: "NPC",
        pluralLabel: "NPCs",
        method: "report",
        list: async (ctx) =>
            (await listAllNpcs(ctx)).map((entry) => npcPosIdentity(entry.pos)),
    },
    ITEM: null,
} satisfies Record<Importable["type"], PruneType | null>;

export type PrunableType = {
    [K in keyof typeof PRUNE_TYPES]: (typeof PRUNE_TYPES)[K] extends null ? never : K;
}[keyof typeof PRUNE_TYPES];

/** The prunable types in scan order — cheap list reads before menu walks. */
export const PRUNABLE_TYPES = (
    Object.keys(PRUNE_TYPES) as Importable["type"][]
).filter((type) => PRUNE_TYPES[type] !== null) as PrunableType[];

export function pruneTypeOf(type: PrunableType): PruneType {
    return PRUNE_TYPES[type];
}

export function isPrunableType(type: Importable["type"]): type is PrunableType {
    return PRUNE_TYPES[type] !== null;
}

export function isProtectedIdentity(spec: PruneType, identity: string): boolean {
    const protectedIdentities = spec.protectedIdentities;
    if (protectedIdentities === undefined) return false;
    const lower = identity.trim().toLowerCase();
    for (const candidate of protectedIdentities) {
        if (candidate.toLowerCase() === lower) return true;
    }
    return false;
}
