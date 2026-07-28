import type { ImportableTeam } from "htsw/types";

import type { ImportableTrustPlan } from "../../importCache";
import TaskContext from "../../tasks/context";
import type { ImportContext } from "../import/context";
import { listAllTeamNames, openManageTeam } from "./listTeams";
import {
    createTeam,
    readTeamSettings,
    setTeamColor,
    setTeamFriendlyFire,
    setTeamTag,
} from "./housing";
import { COST } from "../../housingSync/progress/costs";
import {
    defineApplicationPlan,
    workStep,
    type ApplicationPlan,
    type ApplicationProgress,
    type ApplicationStep,
} from "../import/applicationProgress";

export type TeamImportPlan = {
    kind: "TEAM";
    importable: ImportableTeam;
    trustPlan?: ImportableTrustPlan;
    exists: boolean;
    tagHandled: boolean;
    colorHandled: boolean;
    friendlyFireHandled: boolean;
};

export type TeamRead = {
    kind: "TEAM";
    importable: ImportableTeam;
    trustPlan?: ImportableTrustPlan;
    settings: ReturnType<typeof readTeamSettings> | null;
};

export async function readImportableTeam(
    ctx: TaskContext,
    importable: ImportableTeam,
    trustPlan?: ImportableTrustPlan
): Promise<TeamRead> {
    const exists = (await listAllTeamNames(ctx)).indexOf(importable.name) >= 0;
    if (!exists) {
        return { kind: "TEAM", importable, trustPlan, settings: null };
    }

    await openManageTeam(ctx, importable.name);
    return { kind: "TEAM", importable, trustPlan, settings: readTeamSettings(ctx) };
}

export function planImportableTeam(read: TeamRead): TeamImportPlan {
    const { importable, settings } = read;
    return {
        kind: "TEAM",
        importable,
        trustPlan: read.trustPlan,
        exists: settings !== null,
        tagHandled:
            importable.tag === undefined ||
            (settings !== null && settings.tag === importable.tag),
        colorHandled:
            importable.color === undefined ||
            (settings !== null && settings.color === importable.color),
        friendlyFireHandled:
            importable.friendlyFire === undefined ||
            (settings !== null && settings.friendlyFire === importable.friendlyFire),
    };
}

export async function applyImportableTeamPlan(
    ctx: TaskContext,
    plan: TeamImportPlan,
    _session: ImportContext,
    application: ApplicationProgress
): Promise<void> {
    const { importable } = plan;
    if (teamPlanIsNoOp(plan)) return;
    if (!plan.exists) {
        await application.run("create", () => createTeam(ctx, importable.name));
    }

    await application.run("openManage", () => openManageTeam(ctx, importable.name));

    const tag = importable.tag;
    if (tag !== undefined && !plan.tagHandled) {
        await application.run("tag", () => setTeamTag(ctx, tag));
    }
    const color = importable.color;
    if (color !== undefined && !plan.colorHandled) {
        await application.run("color", () => setTeamColor(ctx, color));
    }
    const friendlyFire = importable.friendlyFire;
    if (friendlyFire !== undefined && !plan.friendlyFireHandled) {
        await application.run("friendlyFire", () =>
            setTeamFriendlyFire(ctx, friendlyFire)
        );
    }
}

export function teamPlanIsNoOp(plan: TeamImportPlan): boolean {
    return (
        plan.exists && plan.tagHandled && plan.colorHandled && plan.friendlyFireHandled
    );
}

export function teamPlanApplicationUnits(plan: TeamImportPlan): number {
    return teamApplicationPlan(plan).totalUnits;
}

export function teamApplicationPlan(plan: TeamImportPlan): ApplicationPlan {
    const steps: ApplicationStep[] = [];
    if (!teamPlanIsNoOp(plan)) {
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
                "openManage",
                COST.commandInterval + COST.commandMenuWait + COST.menuClickWait
            )
        );
        if (!plan.tagHandled) steps.push(workStep("tag", COST.chatInput));
        if (!plan.colorHandled) {
            steps.push(workStep("color", COST.menuClickWait * 2));
        }
        if (!plan.friendlyFireHandled) {
            steps.push(workStep("friendlyFire", COST.menuClickWait));
        }
    }
    steps.push(workStep("cache", COST.cacheWrite));
    return defineApplicationPlan(steps);
}
