import type { TaskWaiter } from "../../tasks/context";
import TaskContext from "../../tasks/context";
import { menuOpened } from "../../housingSync/menus/menuWaiters";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import {
    findPaginatedListEntry,
    getVisiblePaginatedItemSlots,
    isEmptyPaginatedPlaceholder,
    readPaginatedList,
    type PaginatedListConfig,
} from "../../housingSync/menus/paginatedList";
import { ItemSlot, MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";

const TEAM_LIST_CONFIG: PaginatedListConfig = {
    label: "team",
    emptyPlaceholderName: "No teams!",
};

export type TeamListEntry = {
    index: number;
    name: string;
};

// The /teams grid mixes team heads with fixed controls; these are not teams.
const TEAM_LIST_CONTROLS = new Set([
    "create team",
    "team settings",
    "go back",
    "close",
]);

function stripTooltipDebugSuffix(name: string): string {
    return name.replace(/\s*\(#[0-9a-fA-F]+(?:\/[0-9]+)?\)\s*$/, "").trim();
}

function teamNameFromSlotName(rawDisplayName: string): string | null {
    const name = stripTooltipDebugSuffix(removedFormatting(rawDisplayName).trim());
    if (name.length === 0) return null;
    if (TEAM_LIST_CONTROLS.has(name.toLowerCase())) return null;
    return name;
}

function readTeamEntryFromSlot(slot: ItemSlot, index: number): TeamListEntry | null {
    const item = slot.getItem();
    if (item === null || item === undefined) return null;
    const name = teamNameFromSlotName(item.getName());
    return name === null ? null : { index, name };
}

function readVisibleTeamEntries(ctx: TaskContext): TeamListEntry[] {
    const out: TeamListEntry[] = [];
    const slots = getVisiblePaginatedItemSlots(ctx);
    for (let i = 0; i < slots.length; i++) {
        if (isEmptyPaginatedPlaceholder(slots[i], TEAM_LIST_CONFIG)) continue;
        const entry = readTeamEntryFromSlot(slots[i], i);
        if (entry !== null) out.push(entry);
    }
    return out;
}

function teamsListOpened(): TaskWaiter<void> {
    return menuOpened({
        kind: "commandMenuWait",
        label: "Waiting for teams list",
        items: ["Create Team"],
    });
}

function manageTeamOpened(): TaskWaiter<void> {
    return menuOpened({
        kind: "menuClickWait",
        label: "Waiting for team management menu",
        items: ["Friendly Fire"],
    });
}

export async function openTeamsList(ctx: TaskContext): Promise<void> {
    await ctx.expectAfter(() => ctx.runCommand("/teams"), teamsListOpened());
}

async function listAllTeams(ctx: TaskContext): Promise<TeamListEntry[]> {
    await openTeamsList(ctx);
    return await readPaginatedList<TeamListEntry>(
        ctx,
        TEAM_LIST_CONFIG,
        async () => readVisibleTeamEntries(ctx)
    );
}

export async function listAllTeamNames(ctx: TaskContext): Promise<string[]> {
    return (await listAllTeams(ctx)).map((entry) => entry.name);
}

export async function openManageTeam(
    ctx: TaskContext,
    name: string
): Promise<TeamListEntry> {
    await openTeamsList(ctx);
    const found = await findPaginatedListEntry(
        ctx,
        TEAM_LIST_CONFIG,
        async () => readVisibleTeamEntries(ctx),
        (entry) => entry.name === name
    );
    if (found === null) {
        throw new Error(`No team named "${name}" exists in this house.`);
    }
    await ctx.expectAfter(
        () => found.slot.click(MouseButton.LEFT),
        manageTeamOpened()
    );
    return found.entry;
}

export async function deleteTeam(ctx: TaskContext, name: string): Promise<void> {
    await openManageTeam(ctx, name);
    ctx.getMenuItemSlot("Delete Team").click();
    await timedWaitForMenu(ctx, "menuClickWait");
}
