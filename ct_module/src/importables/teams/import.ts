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
            settings !== null &&
            (importable.tag === undefined || settings.tag === importable.tag),
        colorHandled:
            settings !== null &&
            (importable.color === undefined || settings.color === importable.color),
        friendlyFireHandled:
            settings !== null &&
            (importable.friendlyFire === undefined ||
                settings.friendlyFire === importable.friendlyFire),
    };
}

export async function applyImportableTeamPlan(
    ctx: TaskContext,
    plan: TeamImportPlan,
    _session: ImportContext
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
