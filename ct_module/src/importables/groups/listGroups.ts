import type { TaskWaiter } from "../../tasks/context";
import TaskContext from "../../tasks/context";
import { menuOpened } from "../../housingSync/menus/menuWaiters";
import { timedWaitForMenu, waitForMenu } from "../../housingSync/menus/menuWait";
import { enterValue } from "../../housingSync/menus/menuUtils";
import { isAtMenuTitle } from "../../housingSync/menus/currentMenu";
import { ItemSlot, MouseButton, menuStateDescription } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";

const HOUSING_MENU_GROUPS_SLOT = "Permissions and Groups";
const CREATE_GROUP_SLOT = "Create Group";
const DELETE_GROUP_SLOT = "Delete Group";
const CONFIRM_SLOT = "Confirm";

// The Permissions and Groups grid mixes group entries with fixed controls;
// these names are not groups.
const GROUP_LIST_CONTROLS = new Set([
    "create group",
    "main menu",
    "go back",
    "close",
]);

type GroupListEntry = {
    index: number;
    name: string;
};

function stripTooltipDebugSuffix(name: string): string {
    return name.replace(/\s*\(#[0-9a-fA-F]+(?:\/[0-9]+)?\)\s*$/, "").trim();
}

function groupNameFromSlot(slot: ItemSlot): string | null {
    const item = slot.getItem();
    if (item === null || item === undefined) return null;
    const name = stripTooltipDebugSuffix(removedFormatting(item.getName()).trim());
    if (name.length === 0) return null;
    if (GROUP_LIST_CONTROLS.has(name.toLowerCase())) return null;
    return name;
}

function readGroupSlots(ctx: TaskContext): { entry: GroupListEntry; slot: ItemSlot }[] {
    const slots = ctx.getMenuItemSlots();
    if (slots === null) {
        throw new Error(`No open container found${menuStateDescription()}`);
    }
    const out: { entry: GroupListEntry; slot: ItemSlot }[] = [];
    for (let i = 0; i < slots.length; i++) {
        const name = groupNameFromSlot(slots[i]);
        if (name === null) continue;
        out.push({ entry: { index: out.length, name }, slot: slots[i] });
    }
    return out;
}

function housingMenuOpened(): TaskWaiter<void> {
    return menuOpened({
        kind: "commandMenuWait",
        label: "Waiting for Housing menu",
        items: [HOUSING_MENU_GROUPS_SLOT],
    });
}

function groupsListOpened(): TaskWaiter<void> {
    return menuOpened({
        kind: "menuClickWait",
        label: "Waiting for Permissions and Groups list",
        items: [CREATE_GROUP_SLOT],
    });
}

function editGroupOpened(): TaskWaiter<void> {
    return menuOpened({
        kind: "menuClickWait",
        label: "Waiting for group edit menu",
        items: ["Edit Permissions"],
    });
}

// Groups have no slash command; the only entry point is the built-in Housing
// menu (/hmenu) -> "Permissions and Groups".
async function openGroupsList(ctx: TaskContext): Promise<void> {
    // Already in the groups list (the list phase, or a "Go Back" from an edit
    // menu, left us here) — skip the /hmenu round-trip.
    if (isAtMenuTitle(ctx, "Permissions and Groups")) return;

    await ctx.expectAfter(() => ctx.runCommand("/hmenu"), housingMenuOpened());
    await ctx.expectAfter(
        () => ctx.getMenuItemSlot(HOUSING_MENU_GROUPS_SLOT).click(),
        groupsListOpened()
    );
}

async function listAllGroups(ctx: TaskContext): Promise<GroupListEntry[]> {
    await openGroupsList(ctx);
    return readGroupSlots(ctx).map((row) => row.entry);
}

export async function listAllGroupNames(ctx: TaskContext): Promise<string[]> {
    return (await listAllGroups(ctx)).map((entry) => entry.name);
}

export async function openEditGroup(ctx: TaskContext, name: string): Promise<void> {
    await openGroupsList(ctx);
    const rows = readGroupSlots(ctx);
    let match: { entry: GroupListEntry; slot: ItemSlot } | null = null;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].entry.name === name) {
            match = rows[i];
            break;
        }
    }
    if (match === null) {
        throw new Error(`No group named "${name}" exists in this house.`);
    }
    await ctx.expectAfter(
        () => match.slot.click(MouseButton.LEFT),
        editGroupOpened()
    );
}

export async function createGroup(ctx: TaskContext, name: string): Promise<void> {
    await openGroupsList(ctx);
    ctx.getMenuItemSlot(CREATE_GROUP_SLOT).click();
    await enterValue(ctx, name);
    await waitForMenu(ctx);
}

export async function deleteGroup(ctx: TaskContext, name: string): Promise<void> {
    await openEditGroup(ctx, name);
    ctx.getMenuItemSlot(DELETE_GROUP_SLOT).click();
    await timedWaitForMenu(ctx, "menuClickWait");
    const confirm = ctx.tryGetMenuItemSlot(CONFIRM_SLOT);
    if (confirm !== null) {
        confirm.click();
        await timedWaitForMenu(ctx, "menuClickWait");
    }
}
