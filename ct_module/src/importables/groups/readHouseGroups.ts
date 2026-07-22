import type { ChatSpeed, Color, DefaultGameMode, ImportableGroup } from "htsw/types";

import { tryWriteImportableCache } from "../../importCache";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { importJsonTargetForSectionEntry } from "../../project/paths";
import TaskContext from "../../tasks/context";
import { defineHouseExporter } from "../export/exporter";
import { listAllGroupNames, openEditGroup } from "./listGroups";
import {
    readGroupPermissionMenu,
    readGroupSettings,
    type GroupSettings,
} from "./housing";

type GroupRead = {
    settings: GroupSettings;
    permissions: Record<string, boolean>;
    chatSpeed: string | null;
    defaultGameMode: string | null;
};

async function readGroup(ctx: TaskContext, name: string): Promise<GroupRead> {
    await openEditGroup(ctx, name);
    const settings = readGroupSettings(ctx);
    const perms = await readGroupPermissionMenu(ctx);
    return {
        settings,
        permissions: perms.permissions,
        chatSpeed: perms.chatSpeed,
        defaultGameMode: perms.defaultGameMode,
    };
}

function buildGroupImportable(name: string, read: GroupRead): ImportableGroup {
    const { settings } = read;
    return {
        type: "GROUP",
        name,
        ...(settings.tag !== null ? { tag: settings.tag } : {}),
        ...(settings.tagShownInChat !== null
            ? { tagShownInChat: settings.tagShownInChat }
            : {}),
        ...(settings.color !== null ? { color: settings.color as Color } : {}),
        ...(settings.priority !== null ? { priority: settings.priority } : {}),
        ...(Object.keys(read.permissions).length > 0
            ? { permissions: read.permissions }
            : {}),
        ...(read.chatSpeed !== null ? { chatSpeed: read.chatSpeed as ChatSpeed } : {}),
        ...(read.defaultGameMode !== null
            ? { defaultGameMode: read.defaultGameMode as DefaultGameMode }
            : {}),
    };
}

function buildGroupJsonEntry(importable: ImportableGroup): Record<string, unknown> {
    const { type: _type, sourcePath: _sourcePath, ...entry } = importable;
    return {
        ...entry,
    };
}

// Groups are settings-only (no action lists, no items): open each Edit Group
// menu, read its fields and full permission menu, and write the result — to the
// cache in read-only (deep-read) mode, or to import.json plus the cache on a
// real export.
export const readGroups = defineHouseExporter({
    type: "GROUP",
    noun: "group",
    list: listAllGroupNames,
    reader: {
        kind: "direct",
        read: async (ctx, name) => buildGroupImportable(name, await readGroup(ctx, name)),
    },
    importableOf: (importable) => importable,
    export: async (ctx, name, importable, options) => {
        const targetImportJson = importJsonTargetForSectionEntry(
            options.importJsonPath,
            "groups",
            name,
            options.newExportTargetImportJson
        );
        upsertImportableEntry(
            targetImportJson,
            "groups",
            buildGroupJsonEntry(importable)
        );
        await tryWriteImportableCache(ctx, importable, "exporter");
    },
});
