import type { Color, ImportableTeam } from "htsw/types";

import {
    tryWriteImportableCache,
    writeImportableCache,
} from "../../importCache";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { runReadLoop, type ReadFn } from "../read";
import { listAllTeams, openManageTeam } from "./listTeams";
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

// Read/export teams. Teams are settings-only (no action lists), so this is
// just: list, open each Manage Team menu, read its settings, and write the
// result — to the cache in read-only (deep-read) mode, or to import.json plus
// the cache on a real export.
export const readTeams: ReadFn = async (ctx, options) => {
    const readOnly = options.readOnly !== undefined;
    const verb = readOnly ? "Reading" : "Exporting";

    const teams = await listAllTeams(ctx);
    let names: readonly string[];
    if (options.names !== undefined) {
        names = options.names;
    } else {
        names = teams.map((team) => team.name);
        options.onNamesListed?.(names);
    }
    if (names.length === 0) {
        ctx.displayMessage(`&7No teams to ${readOnly ? "read" : "export"}.`);
        return { total: 0, succeeded: 0, failed: 0 };
    }

    ctx.displayMessage(
        `&a${verb} ${names.length} team${names.length === 1 ? "" : "s"}...`
    );
    const result = await runReadLoop(ctx, {
        names,
        verb,
        progress: options.progress,
        processOne: async (ctx, name) => {
            await openManageTeam(ctx, name);
            const settings = readTeamSettings(ctx);
            const importable = buildTeamImportable(name, settings);
            if (options.readOnly !== undefined) {
                writeImportableCache(
                    ctx,
                    options.readOnly.housingUuid,
                    importable,
                    "reader",
                    true
                );
            } else {
                upsertImportableEntry(
                    options.importJsonPath,
                    "teams",
                    buildTeamJsonEntry(name, settings)
                );
                await tryWriteImportableCache(ctx, importable, "exporter");
            }
        },
    });

    const plural = names.length === 1 ? "" : "s";
    const failedNote = result.failed > 0 ? ` &c[${result.failed} failed]` : "";
    if (readOnly) {
        ctx.displayMessage(
            `&aRead ${result.succeeded} of ${names.length} team${plural}${failedNote}`
        );
    } else {
        ctx.displayMessage(
            `&aExported ${result.succeeded} of ${names.length} team${plural}${failedNote}`
        );
        ctx.displayMessage(`&7  -> ${options.importJsonPath}`);
    }
    return { total: names.length, succeeded: result.succeeded, failed: result.failed };
};
