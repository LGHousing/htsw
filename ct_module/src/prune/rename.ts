import TaskContext from "../tasks/context";
import { isTaskCancelled } from "../tasks/manager";
import { chatMessage } from "../housingSync/menus/menuWaiters";
import { renameHouseLockImportable } from "../importCache/houseLock";
import type { PrunableType } from "./registry";

export type PruneRename = {
    type: PrunableType;
    from: string;
    to: string;
};

/**
 * How Housing renames one importable, and how it says it worked. Only types
 * whose confirmation message is known belong here; the rest fall back to
 * delete-and-recreate.
 */
const RENAMEABLE: Partial<
    Record<
        PrunableType,
        { command: (from: string, to: string) => string; confirmation: (from: string, to: string) => string }
    >
> = {
    FUNCTION: {
        command: (from, to) => `/function rename ${from} ${to}`,
        confirmation: (from, to) => `Renamed function ${from} to ${to}`,
    },
    REGION: {
        command: (from, to) => `/region rename ${from} ${to}`,
        confirmation: (from, to) => `Renamed region ${from} to ${to}`,
    },
};

/**
 * A name containing " to " makes Housing's confirmation ambiguous. The chat
 * listeners that keep the house cache current already give up on those.
 */
function renameableIdentity(identity: string): boolean {
    return identity.indexOf(" to ") === -1;
}

function isRenameableType(type: PrunableType): boolean {
    return RENAMEABLE[type] !== undefined;
}

/**
 * Pairs up what one save removed with what it added. Unambiguous cases only —
 * exactly one identity of a type gone and exactly one new. Two of each is not a
 * rename anyone can identify from names alone.
 */
export function detectRenames(
    vanishedByType: ReadonlyMap<PrunableType, readonly string[]>,
    appearedByType: ReadonlyMap<PrunableType, readonly string[]>
): PruneRename[] {
    const renames: PruneRename[] = [];
    for (const [type, vanished] of vanishedByType) {
        if (!isRenameableType(type)) continue;
        const appeared = appearedByType.get(type) ?? [];
        if (vanished.length !== 1 || appeared.length !== 1) continue;
        if (!renameableIdentity(vanished[0]) || !renameableIdentity(appeared[0])) {
            continue;
        }
        renames.push({ type, from: vanished[0], to: appeared[0] });
    }
    return renames;
}

export type RenameOutcome = {
    renamed: PruneRename[];
    /** Renames Housing did not confirm; these fall back to delete-and-create. */
    unconfirmed: PruneRename[];
};

/**
 * Renames in the house, then moves each baseline so the import that follows
 * diffs instead of writing from scratch. Each rename waits for Housing's own
 * confirmation; an unconfirmed one is reported rather than recorded, leaving the
 * old name for the normal prune to remove.
 */
export async function applyRenames(
    ctx: TaskContext,
    manifestPath: string,
    renames: readonly PruneRename[]
): Promise<RenameOutcome> {
    const outcome: RenameOutcome = { renamed: [], unconfirmed: [] };
    for (const rename of renames) {
        ctx.checkCancelled();
        const spec = RENAMEABLE[rename.type];
        if (spec === undefined) {
            outcome.unconfirmed.push(rename);
            continue;
        }
        let confirmed = false;
        try {
            await ctx.expectAfter(
                () => ctx.runCommand(spec.command(rename.from, rename.to)),
                chatMessage(spec.confirmation(rename.from, rename.to))
            );
            confirmed = true;
        } catch (error) {
            // A command Housing does not have never answers, so the wait times
            // out and the pair falls back to delete-and-create.
            if (isTaskCancelled(error)) throw error;
        }
        if (!confirmed) {
            outcome.unconfirmed.push(rename);
            continue;
        }
        // Best-effort — a lost baseline only costs a full re-import.
        renameHouseLockImportable(
            manifestPath,
            rename.type,
            rename.from,
            rename.to
        );
        outcome.renamed.push(rename);
    }
    return outcome;
}
