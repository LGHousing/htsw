import { readFunctions } from "../functions/readHouseFunctions";
import { readEvents } from "../events/readHouseEvents";
import { readMenus } from "../menus/readHouseMenus";
import { readRegions } from "../regions/readHouseRegions";
import { readCommands } from "../commands/readHouseCommands";
import { readTeams } from "../teams/readHouseTeams";
import { readGroups } from "../groups/readHouseGroups";
import {
    readCommandNamesFromImportJson,
    readEventNamesFromImportJson,
    readFunctionNamesFromImportJson,
    readGroupNamesFromImportJson,
    readMenuNamesFromImportJson,
    readRegionNamesFromImportJson,
    readTeamNamesFromImportJson,
} from "../../project/paths";
import type { ReadFn } from "./reader";

export type HouseExportTypeName =
    | "FUNCTION"
    | "EVENT"
    | "MENU"
    | "REGION"
    | "COMMAND"
    | "TEAM"
    | "GROUP";

// One importable type HTSW reads out of a live Housing menu by name. This is the
// single registry the /export slash command AND the GUI house browser both
// dispatch through, so a new name-based export type is wired once here instead
// of in a parallel token list, a switch, a help screen, and the GUI table that
// used to drift apart. NPCs are deliberately absent: they are position-keyed and
// export through `exportAllNpcs`, not a name-based `ReadFn`.
export type HouseExportType = {
    type: HouseExportTypeName;
    // Slash-command token; also matches its own trailing-"s" plural.
    token: string;
    // Singular, lowercase, for chat/help lines.
    label: string;
    // Exportable by name (`/export <token> <name>`). Events are enumerated with
    // no per-name form, so false.
    named: boolean;
    read: ReadFn;
    // Identities this type already declares in an import.json; drives
    // `/export existing`.
    declaredNames: (importJsonPath: string) => readonly string[];
    help: { all: string; named?: string };
};

export const HOUSE_EXPORT_TYPES: HouseExportType[] = [
    {
        type: "FUNCTION",
        token: "function",
        label: "function",
        named: true,
        read: readFunctions,
        declaredNames: readFunctionNamesFromImportJson,
        help: {
            all: "Exports every function not already complete in the target path.",
            named: "Reads a Hypixel function and writes a .htsl + import.json.",
        },
    },
    {
        type: "EVENT",
        token: "event",
        label: "event",
        named: false,
        read: readEvents,
        declaredNames: readEventNamesFromImportJson,
        help: {
            all: "Exports every event not already complete in the target path.",
        },
    },
    {
        type: "MENU",
        token: "menu",
        label: "menu",
        named: true,
        read: readMenus,
        declaredNames: readMenuNamesFromImportJson,
        help: {
            all: "Exports every menu not already complete in the target path.",
            named: "Reads a Hypixel menu and writes deduped item .snbt + per-slot .htsl + import.json.",
        },
    },
    {
        type: "REGION",
        token: "region",
        label: "region",
        named: true,
        read: readRegions,
        declaredNames: readRegionNamesFromImportJson,
        help: {
            all: "Exports every region not already complete in the target path.",
            named: "Reads a Hypixel region and writes bounds + entry/exit .htsl + import.json.",
        },
    },
    {
        type: "COMMAND",
        token: "command",
        label: "command",
        named: true,
        read: readCommands,
        declaredNames: readCommandNamesFromImportJson,
        help: {
            all: "Exports every custom command not already complete in the target path.",
            named: "Reads a Hypixel command and writes actions .htsl + import.json metadata.",
        },
    },
    {
        type: "TEAM",
        token: "team",
        label: "team",
        named: true,
        read: readTeams,
        declaredNames: readTeamNamesFromImportJson,
        help: {
            all: "Exports every team not already in the target path.",
            named: "Reads a Hypixel team and writes its settings into import.json.",
        },
    },
    {
        type: "GROUP",
        token: "group",
        label: "group",
        named: true,
        read: readGroups,
        declaredNames: readGroupNamesFromImportJson,
        help: {
            all: "Exports every group not already in the target path.",
            named: "Reads a Hypixel group and writes its settings + permissions into import.json.",
        },
    },
];

function matchesToken(spec: HouseExportType, token: string): boolean {
    return token === spec.token || token === `${spec.token}s`;
}

export function houseExportTypeByToken(token: string | undefined): HouseExportType | null {
    if (token === undefined) return null;
    for (let i = 0; i < HOUSE_EXPORT_TYPES.length; i++) {
        if (matchesToken(HOUSE_EXPORT_TYPES[i], token)) return HOUSE_EXPORT_TYPES[i];
    }
    return null;
}

export function houseExportTypeOf(type: HouseExportTypeName): HouseExportType {
    for (let i = 0; i < HOUSE_EXPORT_TYPES.length; i++) {
        if (HOUSE_EXPORT_TYPES[i].type === type) return HOUSE_EXPORT_TYPES[i];
    }
    throw new Error(`No house export type registered for ${type}`);
}
