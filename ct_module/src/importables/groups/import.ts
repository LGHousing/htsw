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
import { COST } from "../../housingSync/progress/costs";
import {
    defineApplicationPlan,
    workStep,
    type ApplicationPlan,
    type ApplicationProgress,
    type ApplicationStep,
} from "../import/applicationProgress";

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
    permissions: GroupRead["permissions"];
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

function permissionMenuHandled(plan: GroupImportPlan): boolean {
    return (
        plan.permissionsHandled && plan.chatSpeedHandled && plan.defaultGameModeHandled
    );
}

export async function readImportableGroup(
    ctx: TaskContext,
    importable: ImportableGroup,
    trustPlan?: ImportableTrustPlan
): Promise<GroupRead> {
    const exists = (await listAllGroupNames(ctx)).indexOf(importable.name) >= 0;
    if (!exists) {
        return {
            kind: "GROUP",
            importable,
            trustPlan,
            settings: null,
            permissions: null,
        };
    }

    await openEditGroup(ctx, importable.name);
    const settings = readGroupSettings(ctx);
    const needsPermissionMenu =
        importable.permissions !== undefined ||
        importable.chatSpeed !== undefined ||
        importable.defaultGameMode !== undefined;
    const permissions = needsPermissionMenu ? await readGroupPermissionMenu(ctx) : null;
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
            importable.tag === undefined || (exists && settings.tag === importable.tag),
        tagShownInChatHandled:
            importable.tagShownInChat === undefined ||
            (exists && settings.tagShownInChat === importable.tagShownInChat),
        colorHandled:
            importable.color === undefined ||
            (exists && settings.color === importable.color),
        priorityHandled:
            importable.priority === undefined ||
            (exists && settings.priority === importable.priority),
        permissionsHandled:
            importable.permissions === undefined ||
            (exists &&
                permissions !== null &&
                permissionsMatch(importable.permissions, permissions.permissions)),
        chatSpeedHandled:
            importable.chatSpeed === undefined ||
            (exists && permissions?.chatSpeed === importable.chatSpeed),
        defaultGameModeHandled:
            importable.defaultGameMode === undefined ||
            (exists && permissions?.defaultGameMode === importable.defaultGameMode),
        permissions,
    };
}

export async function applyImportableGroupPlan(
    ctx: TaskContext,
    plan: GroupImportPlan,
    _session: ImportContext,
    application: ApplicationProgress
): Promise<void> {
    const { importable } = plan;
    if (groupPlanIsNoOp(plan)) return;
    if (!plan.exists) {
        await application.run("create", () => createGroup(ctx, importable.name));
    }

    await application.run("openEdit", () => openEditGroup(ctx, importable.name));

    const tag = importable.tag;
    if (tag !== undefined && !plan.tagHandled) {
        await application.run("tag", () => setGroupTag(ctx, tag));
    }
    const tagShownInChat = importable.tagShownInChat;
    if (tagShownInChat !== undefined && !plan.tagShownInChatHandled) {
        await application.run("tagShownInChat", () =>
            setGroupTagShownInChat(ctx, tagShownInChat)
        );
    }
    const color = importable.color;
    if (color !== undefined && !plan.colorHandled) {
        await application.run("color", () => setGroupColor(ctx, color));
    }
    const priority = importable.priority;
    if (priority !== undefined && !plan.priorityHandled) {
        await application.run("priority", () => setGroupPriority(ctx, priority));
    }
    if (!permissionMenuHandled(plan)) {
        await application.run("permissions", () =>
            applyGroupPermissionMenu(
                ctx,
                importable.permissions,
                importable.chatSpeed,
                importable.defaultGameMode
            )
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

export function groupPlanApplicationUnits(plan: GroupImportPlan): number {
    return groupApplicationPlan(plan).totalUnits;
}

export function groupApplicationPlan(plan: GroupImportPlan): ApplicationPlan {
    const steps: ApplicationStep[] = [];
    if (!groupPlanIsNoOp(plan)) {
        if (!plan.exists) {
            steps.push(
                workStep(
                    "create",
                    COST.commandInterval +
                        COST.commandMenuWait +
                        COST.menuClickWait +
                        COST.anvilInput
                )
            );
        }
        steps.push(
            workStep(
                "openEdit",
                COST.commandInterval + COST.commandMenuWait + COST.menuClickWait
            )
        );
        if (!plan.tagHandled) steps.push(workStep("tag", COST.chatInput));
        if (!plan.tagShownInChatHandled) {
            steps.push(workStep("tagShownInChat", COST.menuClickWait));
        }
        if (!plan.colorHandled) {
            steps.push(workStep("color", COST.menuClickWait * 2));
        }
        if (!plan.priorityHandled) {
            steps.push(workStep("priority", COST.chatInput));
        }
        if (!permissionMenuHandled(plan)) {
            let permissionUnits = COST.menuClickWait + COST.goBackWait;
            const desiredPermissions = plan.importable.permissions ?? {};
            const currentPermissions = plan.permissions?.permissions ?? {};
            const permissionNames = Object.keys(desiredPermissions) as Array<
                keyof typeof desiredPermissions
            >;
            for (const name of permissionNames) {
                if (currentPermissions[name] !== desiredPermissions[name]) {
                    permissionUnits += COST.menuClickWait;
                }
            }
            if (!plan.chatSpeedHandled) permissionUnits += COST.menuClickWait;
            if (!plan.defaultGameModeHandled) {
                permissionUnits += COST.menuClickWait;
            }
            steps.push(workStep("permissions", permissionUnits));
        }
    }
    steps.push(workStep("cache", COST.cacheWrite));
    return defineApplicationPlan(steps);
}
