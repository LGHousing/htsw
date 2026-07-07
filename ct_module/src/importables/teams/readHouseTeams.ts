import type { Color, ImportableTeam } from "htsw/types";

import { tryWriteImportableCache, writeImportableCache } from "../../importCache";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import {
    importJsonTargetForSectionEntry,
    teamExportReferencesExist,
} from "../../project/paths";
import { makeReadHouse } from "../readHouse";
import { listAllTeamNames, openManageTeam } from "./listTeams";
import { readTeamSettings, type TeamSettings } from "./shared";

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

function buildTeamJsonEntry(
    name: string,
    settings: TeamSettings
): Record<string, unknown> {
    return {
        name,
        ...(settings.tag !== null ? { tag: settings.tag } : {}),
        ...(settings.color !== null ? { color: settings.color } : {}),
        ...(settings.friendlyFire !== null
            ? { friendlyFire: settings.friendlyFire }
            : {}),
    };
}

// Teams are settings-only (no action lists, no items): open each Manage Team
// menu, read its settings, and write the result — to the cache in read-only
// (deep-read) mode, or to import.json plus the cache on a real export.
export const readTeams = makeReadHouse<string>({
    noun: "team",
    list: listAllTeamNames,
    referencesExist: teamExportReferencesExist,
    readOne: async (ctx, name, options) => {
        await openManageTeam(ctx, name);
        const settings = readTeamSettings(ctx);
        const importable = buildTeamImportable(name, settings);
        if (options.readOnly !== undefined) {
            writeImportableCache(ctx, options.readOnly.housingUuid, importable, "reader", true);
        } else {
            const targetImportJson = importJsonTargetForSectionEntry(
                options.importJsonPath,
                "teams",
                name,
                options.newExportTargetImportJson
            );
            upsertImportableEntry(
                targetImportJson,
                "teams",
                buildTeamJsonEntry(name, settings)
            );
            await tryWriteImportableCache(ctx, importable, "exporter");
        }
    },
});
