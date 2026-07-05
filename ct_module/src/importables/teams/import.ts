import type { ImportableTeam } from "htsw/types";

import type { ImportableTrustPlan } from "../../importCache";
import TaskContext from "../../tasks/context";
import type { ImportSession } from "../imports";
import { listAllTeamNames, openManageTeam } from "./listTeams";
import {
    createTeam,
    readTeamSettings,
    setTeamColor,
    setTeamFriendlyFire,
    setTeamTag,
} from "./shared";

export type TeamImportPlan = {
    kind: "TEAM";
    importable: ImportableTeam;
    trustPlan?: ImportableTrustPlan;
    exists: boolean;
    tagHandled: boolean;
    colorHandled: boolean;
    friendlyFireHandled: boolean;
};

export async function prereadImportableTeam(
    ctx: TaskContext,
    importable: ImportableTeam,
    session: ImportSession,
    trustPlan?: ImportableTrustPlan
): Promise<TeamImportPlan> {
    const exists = (await listAllTeamNames(ctx)).indexOf(importable.name) >= 0;
    if (!exists) {
        return {
            kind: "TEAM",
            importable,
            trustPlan,
            exists: false,
            tagHandled: false,
            colorHandled: false,
            friendlyFireHandled: false,
        };
    }

    await openManageTeam(ctx, importable.name);
    const fields = readTeamSettings(ctx);
    return {
        kind: "TEAM",
        importable,
        trustPlan,
        exists: true,
        tagHandled: importable.tag === undefined || fields.tag === importable.tag,
        colorHandled: importable.color === undefined || fields.color === importable.color,
        friendlyFireHandled:
            importable.friendlyFire === undefined ||
            fields.friendlyFire === importable.friendlyFire,
    };
}

export async function applyImportableTeamPlan(
    ctx: TaskContext,
    plan: TeamImportPlan,
    _session: ImportSession
): Promise<void> {
    const { importable } = plan;
    if (!plan.exists) {
        await createTeam(ctx, importable.name);
    }

    await openManageTeam(ctx, importable.name);

    if (importable.tag !== undefined && !plan.tagHandled) {
        await setTeamTag(ctx, importable.tag);
    }
    if (importable.color !== undefined && !plan.colorHandled) {
        await setTeamColor(ctx, importable.color);
    }
    if (importable.friendlyFire !== undefined && !plan.friendlyFireHandled) {
        await setTeamFriendlyFire(ctx, importable.friendlyFire);
    }
}

export function teamPlanIsNoOp(plan: TeamImportPlan): boolean {
    return (
        plan.exists &&
        plan.tagHandled &&
        plan.colorHandled &&
        plan.friendlyFireHandled
    );
}
