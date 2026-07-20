import type { Color, Permission } from "htsw/types";

import {
    clickGoBack,
    enterValue,
    forEachPaginatedPage,
    openSubmenu,
    tryGetSlotPaginateBy,
} from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu, waitForMenu } from "../../housingSync/menus/menuWait";
import TaskContext from "../../tasks/context";
import { ItemSlot, MouseButton, menuStateDescription } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";

const CHANGE_TAG_SLOT = "Change Tag";
const CHANGE_COLOR_SLOT = "Change Color";
const CHANGE_PRIORITY_SLOT = "Change Priority";
const EDIT_PERMISSIONS_SLOT = "Edit Permissions";

const CURRENT_TAG_LABEL = "Current Tag:";
const TAG_IN_CHAT_LABEL = "Tag Shows in Chat:";
const CURRENT_COLOR_LABEL = "Current Color:";
const CURRENT_PRIORITY_LABEL = "Current Priority:";

export type GroupSettings = {
    tag: string | null;
    tagShownInChat: boolean | null;
    color: string | null;
    priority: number | null;
};

function stripTooltipDebugSuffix(name: string): string {
    return name.replace(/\s*\(#[0-9a-fA-F]+(?:\/[0-9]+)?\)\s*$/, "").trim();
}

// Housing renders a group field as a single "Label: value" lore line
// ("Current Tag: [GUEST]", "Current Color: Gray", "Tag Shows in Chat:
// Disabled"); a value on the following line is tolerated too.
function readLabeledLoreValue(slot: ItemSlot, label: string): string | null {
    const lore = slot.getItem().getLore();
    for (let i = 0; i < lore.length; i++) {
        const line = removedFormatting(lore[i]).trim();
        if (line.indexOf(label) !== 0) continue;
        const inline = line.substring(label.length).trim();
        if (inline.length > 0) return inline;
        if (i + 1 < lore.length) {
            const next = removedFormatting(lore[i + 1]).trim();
            if (next.length > 0) return next;
        }
        return null;
    }
    return null;
}

// Housing displays a group tag wrapped in brackets ("Current Tag: [GUEST]") but
// stores and accepts the bare value; strip the wrapper for the canonical tag.
function stripTagBrackets(value: string): string {
    if (
        value.length >= 2 &&
        value.charAt(0) === "[" &&
        value.charAt(value.length - 1) === "]"
    ) {
        return value.substring(1, value.length - 1);
    }
    return value;
}

function readTagValue(slot: ItemSlot): string | null {
    const raw = readLabeledLoreValue(slot, CURRENT_TAG_LABEL);
    return raw === null ? null : stripTagBrackets(raw);
}

function readEnabledDisabled(value: string | null): boolean | null {
    if (value === null) return null;
    if (value === "Enabled") return true;
    if (value === "Disabled") return false;
    return null;
}

function readPriorityValue(slot: ItemSlot): number | null {
    const raw = readLabeledLoreValue(slot, CURRENT_PRIORITY_LABEL);
    if (raw === null) return null;
    const parsed = Number(raw.split(",").join(""));
    return Number.isFinite(parsed) ? parsed : null;
}

export function readGroupSettings(ctx: TaskContext): GroupSettings {
    const tagSlot = ctx.tryGetMenuItemSlot(CHANGE_TAG_SLOT);
    const colorSlot = ctx.tryGetMenuItemSlot(CHANGE_COLOR_SLOT);
    const prioritySlot = ctx.tryGetMenuItemSlot(CHANGE_PRIORITY_SLOT);
    return {
        tag: tagSlot === null ? null : readTagValue(tagSlot),
        tagShownInChat:
            tagSlot === null
                ? null
                : readEnabledDisabled(readLabeledLoreValue(tagSlot, TAG_IN_CHAT_LABEL)),
        color: colorSlot === null ? null : readLabeledLoreValue(colorSlot, CURRENT_COLOR_LABEL),
        priority: prioritySlot === null ? null : readPriorityValue(prioritySlot),
    };
}

export async function setGroupTag(ctx: TaskContext, tag: string): Promise<void> {
    const slot = ctx.getMenuItemSlot(CHANGE_TAG_SLOT);
    if (readTagValue(slot) === tag) return;
    slot.click(MouseButton.LEFT);
    await enterValue(ctx, tag);
    await waitForMenu(ctx);
}

export async function setGroupTagShownInChat(
    ctx: TaskContext,
    value: boolean
): Promise<void> {
    const slot = ctx.getMenuItemSlot(CHANGE_TAG_SLOT);
    if (readEnabledDisabled(readLabeledLoreValue(slot, TAG_IN_CHAT_LABEL)) === value) return;
    slot.click(MouseButton.RIGHT);
    await timedWaitForMenu(ctx, "menuClickWait");
}

function findColorOption(ctx: TaskContext, color: string): ItemSlot | null {
    return ctx.tryGetMenuItemSlot((slot) => {
        const name = stripTooltipDebugSuffix(
            removedFormatting(slot.getItem().getName()).trim()
        );
        return name === color;
    });
}

export async function setGroupColor(ctx: TaskContext, color: Color): Promise<void> {
    const slot = ctx.getMenuItemSlot(CHANGE_COLOR_SLOT);
    if (readLabeledLoreValue(slot, CURRENT_COLOR_LABEL) === color) return;

    await openSubmenu(ctx, CHANGE_COLOR_SLOT);
    const optionSlot = findColorOption(ctx, color);
    if (optionSlot === null) {
        throw new Error(
            `Could not find color "${color}" in the group color picker${menuStateDescription()}`
        );
    }
    optionSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    if (ctx.tryGetMenuItemSlot(CHANGE_COLOR_SLOT) === null) {
        await clickGoBack(ctx);
    }
}

export async function setGroupPriority(
    ctx: TaskContext,
    priority: number
): Promise<void> {
    const slot = ctx.getMenuItemSlot(CHANGE_PRIORITY_SLOT);
    if (readPriorityValue(slot) === priority) return;
    slot.click();
    await enterValue(ctx, String(priority));
    await waitForMenu(ctx);
}

// A boolean permission renders as a single slot whose name encodes its state,
// e.g. "Button: On" / "Button: Off".
function permMatches(permission: Permission): (slot: ItemSlot) => boolean {
    const onName = `${permission}: On`;
    const offName = `${permission}: Off`;
    return (slot) => {
        const name = stripTooltipDebugSuffix(
            removedFormatting(slot.getItem().getName()).trim()
        );
        return name === onName || name === offName;
    };
}

function readPermState(slot: ItemSlot, permission: Permission): boolean | null {
    const name = stripTooltipDebugSuffix(
        removedFormatting(slot.getItem().getName()).trim()
    );
    if (name === `${permission}: On`) return true;
    if (name === `${permission}: Off`) return false;
    return null;
}

// The two cycle-valued settings that live in the permissions menu alongside the
// toggles. Their slot name encodes the current value ("Chat: Slow 3s",
// "Default Game Mode: ADVENTURE") and a left click advances it, rather than the
// On/Off flip a boolean permission does.
const CHAT_SPEED_LABEL = "Chat";
const DEFAULT_GAME_MODE_LABEL = "Default Game Mode";

function labelPrefixMatch(label: string): (slot: ItemSlot) => boolean {
    const prefix = `${label}: `;
    return (slot) => {
        const item = slot.getItem();
        const name = stripTooltipDebugSuffix(removedFormatting(item.getName()).trim());
        return name.indexOf(prefix) === 0;
    };
}

function readCycleValue(slot: ItemSlot, label: string): string {
    const name = stripTooltipDebugSuffix(removedFormatting(slot.getItem().getName()).trim());
    return name.substring(`${label}: `.length).trim();
}

export type GroupPermissionMenuState = {
    permissions: Record<string, boolean>;
    chatSpeed: string | null;
    defaultGameMode: string | null;
};

// Some groups (the built-in Owner) lock their permissions: the Edit Permissions
// book reads "This group's permissions cannot be modified!" and clicking it
// opens nothing. Detected from the Edit Group menu, before trying to open it.
function groupPermissionsLocked(ctx: TaskContext): boolean {
    const slot = ctx.tryGetMenuItemSlot(EDIT_PERMISSIONS_SLOT);
    if (slot === null) return false;
    // The lore is word-wrapped, so "cannot be modified" is split across two
    // lines ("...cannot be" / "modified!"); join before matching.
    const lore = slot.getItem().getLore();
    const joined: string[] = [];
    for (let i = 0; i < lore.length; i++) joined.push(removedFormatting(lore[i]));
    return joined.join(" ").indexOf("cannot be modified") >= 0;
}

// Open the Edit Permissions submenu (from the Edit Group menu) and read the
// whole menu in one page walk: every boolean toggle plus the two cycle settings.
// One pass keeps a full read cheap even across the six pages. A permission that
// isn't present is simply absent from the map. A locked group (Owner) reads as
// empty rather than hanging on a submenu that never opens.
export async function readGroupPermissionMenu(
    ctx: TaskContext
): Promise<GroupPermissionMenuState> {
    if (groupPermissionsLocked(ctx)) {
        return { permissions: {}, chatSpeed: null, defaultGameMode: null };
    }
    await openSubmenu(ctx, EDIT_PERMISSIONS_SLOT);
    const permissions: Record<string, boolean> = {};
    let chatSpeed: string | null = null;
    let defaultGameMode: string | null = null;
    await forEachPaginatedPage(ctx, () => {
        const slots = ctx.getMenuItemSlots();
        if (slots === null) return;
        for (let i = 0; i < slots.length; i++) {
            const item = slots[i].getItem();
            const name = stripTooltipDebugSuffix(removedFormatting(item.getName()).trim());
            // Cycle labels are checked before the boolean parse: a chat speed of
            // "Off"/"On" makes the name "Chat: Off"/"Chat: On", which would
            // otherwise be misread as a boolean toggle named "Chat".
            if (name.indexOf(`${CHAT_SPEED_LABEL}: `) === 0) {
                chatSpeed = name.substring(`${CHAT_SPEED_LABEL}: `.length).trim();
            } else if (name.indexOf(`${DEFAULT_GAME_MODE_LABEL}: `) === 0) {
                defaultGameMode = name.substring(`${DEFAULT_GAME_MODE_LABEL}: `.length).trim();
            } else {
                const parsed = booleanPermFromName(name);
                if (parsed !== null) permissions[parsed.label] = parsed.value;
            }
        }
    });
    return { permissions, chatSpeed, defaultGameMode };
}

// Advance a cycle to a target value by clicking forward. The click count is
// bounded above the largest cycle (Chat has 11 values) so a stale or unexpected
// value fails loudly instead of looping forever.
async function setGroupCycle(
    ctx: TaskContext,
    label: string,
    value: string
): Promise<void> {
    const match = labelPrefixMatch(label);
    const located = await tryGetSlotPaginateBy(ctx, match);
    if (located === null) {
        throw new Error(
            `Could not find "${label}" in the group permissions menu${menuStateDescription()}`
        );
    }
    if (readCycleValue(located, label) === value) return;

    for (let i = 0; i < 20; i++) {
        const slot = ctx.tryGetMenuItemSlot(match);
        if (slot === null) break;
        slot.click(MouseButton.LEFT);
        await timedWaitForMenu(ctx, "menuClickWait");
        const after = ctx.tryGetMenuItemSlot(match);
        if (after !== null && readCycleValue(after, label) === value) return;
    }
    throw new Error(
        `Could not set "${label}" to "${value}" in the group permissions menu${menuStateDescription()}`
    );
}

// Permissions that pop an "Are you sure?" confirm before the toggle applies.
// They're set outside the page walk so the confirm sub-menu can't throw off the
// walk's page tracking (we don't assume the confirm returns to the same page).
const CONFIRM_GATED_PERMISSIONS = ["Build", "Offline Build"];

async function setConfirmGatedPermission(
    ctx: TaskContext,
    permission: Permission,
    value: boolean
): Promise<void> {
    const slot = await tryGetSlotPaginateBy(ctx, permMatches(permission));
    if (slot === null) {
        throw new Error(
            `Could not find permission "${permission}" in the group permissions menu${menuStateDescription()}`
        );
    }
    if (readPermState(slot, permission) === value) return;
    slot.click(MouseButton.LEFT);
    await timedWaitForMenu(ctx, "menuClickWait");
    const confirm = ctx.tryGetMenuItemSlot("Confirm");
    if (confirm !== null) {
        confirm.click();
        await timedWaitForMenu(ctx, "menuClickWait");
    }
}

// Open the Edit Permissions submenu and apply the requested values, then leave.
// Plain toggles are set in a single page walk (six pages turned once, not once
// per permission); the confirm-gated toggles and the two cycles follow.
export async function applyGroupPermissionMenu(
    ctx: TaskContext,
    permissions: Record<string, boolean> | undefined,
    chatSpeed: string | undefined,
    defaultGameMode: string | undefined
): Promise<void> {
    if (groupPermissionsLocked(ctx)) {
        throw new Error(
            "This group's permissions cannot be modified (e.g. the Owner group). " +
            "Remove permissions, chatSpeed, and defaultGameMode from this group in your import.json."
        );
    }
    await openSubmenu(ctx, EDIT_PERMISSIONS_SLOT);
    if (permissions !== undefined) {
        const names = Object.keys(permissions);
        await forEachPaginatedPage(ctx, async () => {
            for (let i = 0; i < names.length; i++) {
                const name = names[i];
                if (CONFIRM_GATED_PERMISSIONS.indexOf(name) >= 0) continue;
                const permission = name as Permission;
                const slot = ctx.tryGetMenuItemSlot(permMatches(permission));
                if (slot === null) continue;
                if (readPermState(slot, permission) === permissions[name]) continue;
                slot.click(MouseButton.LEFT);
                await timedWaitForMenu(ctx, "menuClickWait");
            }
        });
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            if (CONFIRM_GATED_PERMISSIONS.indexOf(name) < 0) continue;
            await setConfirmGatedPermission(ctx, name as Permission, permissions[name]);
        }
    }
    if (chatSpeed !== undefined) {
        await setGroupCycle(ctx, CHAT_SPEED_LABEL, chatSpeed);
    }
    if (defaultGameMode !== undefined) {
        await setGroupCycle(ctx, DEFAULT_GAME_MODE_LABEL, defaultGameMode);
    }
    await clickGoBack(ctx);
}

export async function openGroupPermissions(ctx: TaskContext): Promise<void> {
    await openSubmenu(ctx, EDIT_PERMISSIONS_SLOT);
}

function booleanPermFromName(name: string): { label: string; value: boolean } | null {
    if (name.substring(name.length - 4) === ": On") {
        return { label: name.substring(0, name.length - 4), value: true };
    }
    if (name.substring(name.length - 5) === ": Off") {
        return { label: name.substring(0, name.length - 5), value: false };
    }
    return null;
}
