import type { ImportableGroup } from "htsw/types";

import type { ImportableTrustPlan } from "../../importCache";
import TaskContext from "../../tasks/context";
import type { ImportSession } from "../imports";
import { createGroup, listAllGroupNames, openEditGroup } from "./listGroups";
import {
    applyGroupPermissionMenu,
    readGroupPermissionMenu,
    readGroupSettings,
    setGroupColor,
    setGroupPriority,
    setGroupTag,
    setGroupTagShownInChat,
} from "./shared";

export type GroupImportPlan = {
    kind: "GROUP";
    importable: ImportableGroup;
    trustPlan?: ImportableTrustPlan;
    exists: boolean;
    tagHandled: boolean;
    tagShownInChatHandled: boolean;
    colorHandled: boolean;
    priorityHandled: boolean;
    permissionsHandled: boolean;
    chatSpeedHandled: boolean;
    defaultGameModeHandled: boolean;
};

function permissionsMatch(
    desired: Record<string, boolean>,
    current: Record<string, boolean>
): boolean {
    const names = Object.keys(desired);
    for (let i = 0; i < names.length; i++) {
        if (current[names[i]] !== desired[names[i]]) return false;
    }
    return true;
}

// True when a group's permission menu (boolean toggles + the two cycles) needs
// no writes: the whole submenu can be skipped in the apply pass.
function permissionMenuHandled(plan: GroupImportPlan): boolean {
    return plan.permissionsHandled && plan.chatSpeedHandled && plan.defaultGameModeHandled;
}

export async function prereadImportableGroup(
    ctx: TaskContext,
    importable: ImportableGroup,
    session: ImportSession,
    trustPlan?: ImportableTrustPlan
): Promise<GroupImportPlan> {
    const exists = (await listAllGroupNames(ctx)).indexOf(importable.name) >= 0;
    if (!exists) {
        return {
            kind: "GROUP",
            importable,
            trustPlan,
            exists: false,
            tagHandled: false,
            tagShownInChatHandled: false,
            colorHandled: false,
            priorityHandled: false,
            permissionsHandled: false,
            chatSpeedHandled: false,
            defaultGameModeHandled: false,
        };
    }

    await openEditGroup(ctx, importable.name);
    const fields = readGroupSettings(ctx);

    let permissionsHandled = true;
    let chatSpeedHandled = true;
    let defaultGameModeHandled = true;
    const needsPermissionMenu =
        importable.permissions !== undefined ||
        importable.chatSpeed !== undefined ||
        importable.defaultGameMode !== undefined;
    if (needsPermissionMenu) {
        const state = await readGroupPermissionMenu(ctx);
        permissionsHandled = permissionsMatch(importable.permissions ?? {}, state.permissions);
        chatSpeedHandled =
            importable.chatSpeed === undefined || state.chatSpeed === importable.chatSpeed;
        defaultGameModeHandled =
            importable.defaultGameMode === undefined ||
            state.defaultGameMode === importable.defaultGameMode;
    }

    return {
        kind: "GROUP",
        importable,
        trustPlan,
        exists: true,
        tagHandled: importable.tag === undefined || fields.tag === importable.tag,
        tagShownInChatHandled:
            importable.tagShownInChat === undefined ||
            fields.tagShownInChat === importable.tagShownInChat,
        colorHandled: importable.color === undefined || fields.color === importable.color,
        priorityHandled:
            importable.priority === undefined || fields.priority === importable.priority,
        permissionsHandled,
        chatSpeedHandled,
        defaultGameModeHandled,
    };
}

export async function applyImportableGroupPlan(
    ctx: TaskContext,
    plan: GroupImportPlan,
    _session: ImportSession
): Promise<void> {
    const { importable } = plan;
    if (!plan.exists) {
        await createGroup(ctx, importable.name);
    }

    await openEditGroup(ctx, importable.name);

    if (importable.tag !== undefined && !plan.tagHandled) {
        await setGroupTag(ctx, importable.tag);
    }
    if (importable.tagShownInChat !== undefined && !plan.tagShownInChatHandled) {
        await setGroupTagShownInChat(ctx, importable.tagShownInChat);
    }
    if (importable.color !== undefined && !plan.colorHandled) {
        await setGroupColor(ctx, importable.color);
    }
    if (importable.priority !== undefined && !plan.priorityHandled) {
        await setGroupPriority(ctx, importable.priority);
    }
    if (!permissionMenuHandled(plan)) {
        await applyGroupPermissionMenu(
            ctx,
            importable.permissions,
            importable.chatSpeed,
            importable.defaultGameMode
        );
    }
}

export function groupPlanIsNoOp(plan: GroupImportPlan): boolean {
    return (
        plan.exists &&
        plan.tagHandled &&
        plan.tagShownInChatHandled &&
        plan.colorHandled &&
        plan.priorityHandled &&
        permissionMenuHandled(plan)
    );
}
