import type { ChatSpeed, Color, DefaultGameMode, ImportableGroup, Permission } from "htsw/types";

import { tryWriteImportableCache, writeImportableCache } from "../../importCache";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { importJsonTargetForSectionEntry } from "../../project/paths";
import TaskContext from "../../tasks/context";
import { makeReadHouse } from "../readHouse";
import { listAllGroupNames, openEditGroup } from "./listGroups";
import { readGroupPermissionMenu, readGroupSettings, type GroupSettings } from "./shared";

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
            ? { permissions: read.permissions as Record<Permission, boolean> }
            : {}),
        ...(read.chatSpeed !== null ? { chatSpeed: read.chatSpeed as ChatSpeed } : {}),
        ...(read.defaultGameMode !== null
            ? { defaultGameMode: read.defaultGameMode as DefaultGameMode }
            : {}),
    };
}

function buildGroupJsonEntry(name: string, read: GroupRead): Record<string, unknown> {
    const { settings } = read;
    return {
        name,
        ...(settings.tag !== null ? { tag: settings.tag } : {}),
        ...(settings.tagShownInChat !== null
            ? { tagShownInChat: settings.tagShownInChat }
            : {}),
        ...(settings.color !== null ? { color: settings.color } : {}),
        ...(settings.priority !== null ? { priority: settings.priority } : {}),
        ...(Object.keys(read.permissions).length > 0
            ? { permissions: read.permissions }
            : {}),
        ...(read.chatSpeed !== null ? { chatSpeed: read.chatSpeed } : {}),
        ...(read.defaultGameMode !== null
            ? { defaultGameMode: read.defaultGameMode }
            : {}),
    };
}

// Groups are settings-only (no action lists, no items): open each Edit Group
// menu, read its fields and full permission menu, and write the result — to the
// cache in read-only (deep-read) mode, or to import.json plus the cache on a
// real export.
export const readGroups = makeReadHouse<string>({
    noun: "group",
    list: listAllGroupNames,
    readOne: async (ctx, name, options) => {
        const read = await readGroup(ctx, name);
        const importable = buildGroupImportable(name, read);
        if (options.readOnly !== undefined) {
            writeImportableCache(ctx, options.readOnly.housingUuid, importable, "reader", true);
        } else {
            const targetImportJson = importJsonTargetForSectionEntry(
                options.importJsonPath,
                "groups",
                name,
                options.newExportTargetImportJson
            );
            upsertImportableEntry(targetImportJson, "groups", buildGroupJsonEntry(name, read));
            await tryWriteImportableCache(ctx, importable, "exporter");
        }
    },
});
