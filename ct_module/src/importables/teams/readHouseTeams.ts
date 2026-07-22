import type { Color, ImportableTeam } from "htsw/types";

import { tryWriteImportableCache } from "../../importCache";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import {
    importJsonTargetForSectionEntry,
    teamExportReferencesExist,
} from "../../project/paths";
import { defineHouseExporter } from "../export/exporter";
import { listAllTeamNames, openManageTeam } from "./listTeams";
import { readTeamSettings, type TeamSettings } from "./housing";

function buildTeamImportable(name: string, settings: TeamSettings): ImportableTeam {
    return {
        type: "TEAM",
        name,
        ...(settings.tag !== null ? { tag: settings.tag } : {}),
        ...(settings.color !== null ? { color: settings.color as Color } : {}),
        ...(settings.friendlyFire !== null
            ? { friendlyFire: settings.friendlyFire }
            : {}),
    };
}

function buildTeamJsonEntry(importable: ImportableTeam): Record<string, unknown> {
    const { type: _type, sourcePath: _sourcePath, ...entry } = importable;
    return entry;
}

// Teams are settings-only (no action lists, no items): open each Manage Team
// menu, read its settings, and write the result — to the cache in read-only
// (deep-read) mode, or to import.json plus the cache on a real export.
export const readTeams = defineHouseExporter({
    type: "TEAM",
    noun: "team",
    list: listAllTeamNames,
    referencesExist: teamExportReferencesExist,
    reader: {
        kind: "direct",
        read: async (ctx, name) => {
            await openManageTeam(ctx, name);
            return buildTeamImportable(name, readTeamSettings(ctx));
        },
    },
    importableOf: (importable) => importable,
    export: async (ctx, name, importable, options) => {
        const targetImportJson = importJsonTargetForSectionEntry(
            options.importJsonPath,
            "teams",
            name,
            options.newExportTargetImportJson
        );
        upsertImportableEntry(
            targetImportJson,
            "teams",
            buildTeamJsonEntry(importable)
        );
        await tryWriteImportableCache(ctx, importable, "exporter");
    },
});
