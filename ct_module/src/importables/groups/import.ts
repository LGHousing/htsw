import type { ImportableGroup } from "htsw/types";

import type { ImportableTrustPlan } from "../../importCache";
import TaskContext from "../../tasks/context";
import type { ImportContext } from "../import/context";
import { createGroup, listAllGroupNames, openEditGroup } from "./listGroups";
import {
    applyGroupPermissionMenu,
    readGroupPermissionMenu,
    readGroupSettings,
    setGroupColor,
    setGroupPriority,
    setGroupTag,
    setGroupTagShownInChat,
} from "./housing";

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

export type GroupRead = {
    kind: "GROUP";
    importable: ImportableGroup;
    trustPlan?: ImportableTrustPlan;
    settings: ReturnType<typeof readGroupSettings> | null;
    permissions: Awaited<ReturnType<typeof readGroupPermissionMenu>> | null;
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

export async function readImportableGroup(
    ctx: TaskContext,
    importable: ImportableGroup,
    trustPlan?: ImportableTrustPlan
): Promise<GroupRead> {
    const exists = (await listAllGroupNames(ctx)).indexOf(importable.name) >= 0;
    if (!exists) {
        return { kind: "GROUP", importable, trustPlan, settings: null, permissions: null };
    }

    await openEditGroup(ctx, importable.name);
    const settings = readGroupSettings(ctx);
    const needsPermissionMenu =
        importable.permissions !== undefined ||
        importable.chatSpeed !== undefined ||
        importable.defaultGameMode !== undefined;
    const permissions = needsPermissionMenu
        ? await readGroupPermissionMenu(ctx)
        : null;
    return { kind: "GROUP", importable, trustPlan, settings, permissions };
}

export function planImportableGroup(read: GroupRead): GroupImportPlan {
    const { importable, settings, permissions } = read;
    const exists = settings !== null;

    return {
        kind: "GROUP",
        importable,
        trustPlan: read.trustPlan,
        exists,
        tagHandled:
            exists &&
            (importable.tag === undefined || settings.tag === importable.tag),
        tagShownInChatHandled:
            exists &&
            (importable.tagShownInChat === undefined ||
                settings.tagShownInChat === importable.tagShownInChat),
        colorHandled:
            exists &&
            (importable.color === undefined || settings.color === importable.color),
        priorityHandled:
            exists &&
            (importable.priority === undefined ||
                settings.priority === importable.priority),
        permissionsHandled:
            exists &&
            (importable.permissions === undefined ||
                (permissions !== null &&
                    permissionsMatch(
                        importable.permissions,
                        permissions.permissions
                    ))),
        chatSpeedHandled:
            exists &&
            (importable.chatSpeed === undefined ||
                permissions?.chatSpeed === importable.chatSpeed),
        defaultGameModeHandled:
            exists &&
            (importable.defaultGameMode === undefined ||
                permissions?.defaultGameMode === importable.defaultGameMode),
    };
}

export async function applyImportableGroupPlan(
    ctx: TaskContext,
    plan: GroupImportPlan,
    _session: ImportContext
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
