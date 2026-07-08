/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";
import { Icons, type IconName } from "../../lib/icons.generated";
import type { HouseImportable } from "../../../importCache/cache";
import {
    getHouseFunctions,
    houseFunctionsScanned,
    isFunctionScanInFlight,
    scanHouseFunctions,
} from "./sources/functionsSource";
import {
    getHouseEvents,
    houseEventsScanned,
    isEventScanInFlight,
    scanHouseEvents,
} from "./sources/eventsSource";
import {
    getHouseMenus,
    houseMenusScanned,
    isMenuScanInFlight,
    scanHouseMenus,
} from "./sources/menusSource";
import {
    getHouseRegions,
    houseRegionsScanned,
    isRegionScanInFlight,
    scanHouseRegions,
} from "./sources/regionsSource";
import {
    getHouseCommands,
    houseCommandsScanned,
    isCommandScanInFlight,
    scanHouseCommands,
} from "./sources/commandsSource";
import { houseExportTypeOf } from "../../../importables/houseExportTypes";
import {
    getHouseTeams,
    houseTeamsScanned,
    isTeamScanInFlight,
    scanHouseTeams,
} from "./sources/teamsSource";
import {
    getHouseGroups,
    houseGroupsScanned,
    isGroupScanInFlight,
    scanHouseGroups,
} from "./sources/groupsSource";
import {
    getHouseNpcs,
    houseNpcsScanned,
    isNpcScanInFlight,
    scanHouseNpcs,
} from "./sources/npcsSource";
import { readNpcs } from "../../../importables/npcs/readHouseNpcs";
import { type HouseReadableType } from "../../../importables/houseReaders";
import { startExport, type ExportSpec } from "../../export/taskController";
import { makeDeepRead } from "./sources/deepRead";
import type TaskContext from "../../../tasks/context";
import { TaskManager } from "../../../tasks/manager";
import { showToast } from "../../toast";
import { parseNpcPosIdentity } from "../../../importables/identity";
import { openEventEditor } from "../../../importables/events/shared";
import { openManageTeam } from "../../../importables/teams/listTeams";
import { openEditGroup } from "../../../importables/groups/listGroups";
import {
    openNpcEditorForPos,
    teleportToNpc,
} from "../../../importables/npcs/listNpcs";

// House readers come from the shared export registry, so this browser and the
// /export slash command can never disagree on which types export or how. A GUI
// export row for a type missing from the registry throws on load rather than
// silently drifting out of the slash command.
const readFunctions = houseExportTypeOf("FUNCTION").read;
const readEvents = houseExportTypeOf("EVENT").read;
const readMenus = houseExportTypeOf("MENU").read;
const readRegions = houseExportTypeOf("REGION").read;
const readCommands = houseExportTypeOf("COMMAND").read;
const readTeams = houseExportTypeOf("TEAM").read;
const readGroups = houseExportTypeOf("GROUP").read;

// One browsable category of house contents. The Houses view is generic over
// this: it dispatches scan/list/edit/export through the active entry.
export type HouseContentType = {
    type: Importable["type"];
    label: string;
    icon: IconName;
    items: (uuid: string | null) => HouseImportable[];
    scanned: (uuid: string | null) => boolean;
    scan: () => void;
    scanInFlight: () => boolean;
    scanNames?: boolean;
    // Deep read: pull importables' full content from the house into the cache
    // as verified knowledge (slow; explicit) — the export driver in read-only
    // mode. `onlyNames` limits the pass to a selection; omitted = whole house.
    deepRead?: (onlyNames?: string[]) => void;
    rowActions?: { label: string; icon: IconName; run: (name: string) => void }[];
    remove?: (name: string) => void;
    // Present only for types that can be written into the loaded import.json.
    // Export reads the live housing menu, so the view still gates it on standing
    // in the house. A type without this hook is browse-only.
    export?: {
        selected: (names: string[], onDone: () => void) => void;
        all: () => void;
    };
};

// Both the selected and export-all paths go through the one generic
// `startExport`; the type only supplies its batch exporter + a label.
function exportHook(spec: ExportSpec): HouseContentType["export"] {
    return {
        selected: (names, onDone) => startExport(spec, names, onDone),
        all: () => startExport(spec),
    };
}

// Fire a one-shot menu-navigation task from a row action (open an importable's
// editor, teleport). Types with no per-importable slash command reach their
// editor by walking the live menu, which must run as a task. Guards against
// overlapping tasks and toasts on failure.
function runMenuTask(label: string, fn: (ctx: TaskContext) => Promise<unknown>): void {
    if (TaskManager.hasRunningTasks()) {
        showToast("A task is already running — wait for it to finish", 0xffe5bc4b);
        return;
    }
    TaskManager.run(async (ctx) => {
        await fn(ctx);
    }).catch((err: unknown) => {
        showToast(`${label} failed: ${err}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] ${label} failed: ${err}`);
    });
}

// Keyed by importable type and total over the house-readable set (derived from
// HOUSE_READERS), so a new house-readable type is a compile error until it gets
// a tab here. `HouseContentType & { type: K }` also pins each entry's `type`
// field to its key. HOUSE_CONTENT_TYPES below is the ordered array the view
// consumes; Object.keys preserves this insertion order.
const HOUSE_CONTENT_BY_TYPE: { [K in HouseReadableType]: HouseContentType & { type: K } } = {
    FUNCTION: {
        type: "FUNCTION",
        label: "Functions",
        icon: Icons.squareFunction,
        items: getHouseFunctions,
        scanned: houseFunctionsScanned,
        scan: scanHouseFunctions,
        scanInFlight: isFunctionScanInFlight,
        deepRead: makeDeepRead("FUNCTION", "function", readFunctions, isFunctionScanInFlight),
        rowActions: [
            {
                label: "Run",
                icon: Icons.play,
                run: (name) => ChatLib.command(`function run ${name}`),
            },
            {
                label: "Edit",
                icon: Icons.pencil,
                run: (name) => ChatLib.command(`function edit ${name}`),
            },
        ],
        remove: (name) => ChatLib.command(`function delete ${name}`),
        export: exportHook({ type: "FUNCTION", label: "function", read: readFunctions }),
    },
    MENU: {
        type: "MENU",
        label: "Menus",
        icon: Icons.squareMenu,
        items: getHouseMenus,
        scanned: houseMenusScanned,
        scan: scanHouseMenus,
        scanInFlight: isMenuScanInFlight,
        deepRead: makeDeepRead("MENU", "menu", readMenus, isMenuScanInFlight),
        rowActions: [
            {
                label: "View",
                icon: Icons.eye,
                run: (name) => ChatLib.command(`menu display ${name}`),
            },
            {
                label: "Edit",
                icon: Icons.pencil,
                run: (name) => ChatLib.command(`menu edit ${name}`),
            },
        ],
        export: exportHook({ type: "MENU", label: "menu", read: readMenus }),
    },
    REGION: {
        type: "REGION",
        label: "Regions",
        icon: Icons.cuboid,
        items: getHouseRegions,
        scanned: houseRegionsScanned,
        scan: scanHouseRegions,
        scanInFlight: isRegionScanInFlight,
        deepRead: makeDeepRead("REGION", "region", readRegions, isRegionScanInFlight),
        rowActions: [
            {
                label: "Edit",
                icon: Icons.pencil,
                run: (name) => ChatLib.command(`region edit ${name}`),
            },
        ],
        remove: (name) => ChatLib.command(`region delete ${name}`),
        export: exportHook({ type: "REGION", label: "region", read: readRegions }),
    },
    COMMAND: {
        type: "COMMAND",
        label: "Commands",
        icon: Icons.command,
        items: getHouseCommands,
        scanned: houseCommandsScanned,
        scan: scanHouseCommands,
        scanInFlight: isCommandScanInFlight,
        deepRead: makeDeepRead("COMMAND", "command", readCommands, isCommandScanInFlight),
        rowActions: [
            { label: "Run", icon: Icons.play, run: (name) => ChatLib.command(name) },
            {
                label: "Edit",
                icon: Icons.pencil,
                run: (name) => ChatLib.command(`command edit ${name}`),
            },
        ],
        remove: (name) => ChatLib.command(`command delete ${name}`),
        export: exportHook({ type: "COMMAND", label: "command", read: readCommands }),
    },
    EVENT: {
        // Housing has no per-event edit command, so Edit walks the /eventactions
        // menu to the specific event's action editor.
        type: "EVENT",
        label: "Events",
        icon: Icons.zap,
        items: getHouseEvents,
        scanned: houseEventsScanned,
        scan: scanHouseEvents,
        scanInFlight: isEventScanInFlight,
        scanNames: false,
        deepRead: makeDeepRead("EVENT", "event", readEvents, isEventScanInFlight),
        rowActions: [
            {
                label: "Edit",
                icon: Icons.pencil,
                run: (name) => runMenuTask("open event", (ctx) => openEventEditor(ctx, name)),
            },
        ],
        export: exportHook({ type: "EVENT", label: "event", read: readEvents }),
    },
    TEAM: {
        type: "TEAM",
        label: "Teams",
        icon: Icons.users,
        items: getHouseTeams,
        scanned: houseTeamsScanned,
        scan: scanHouseTeams,
        scanInFlight: isTeamScanInFlight,
        deepRead: makeDeepRead("TEAM", "team", readTeams, isTeamScanInFlight),
        rowActions: [
            {
                label: "Edit",
                icon: Icons.pencil,
                run: (name) => runMenuTask("open team", (ctx) => openManageTeam(ctx, name)),
            },
        ],
        remove: (name) => ChatLib.command(`team delete ${name}`),
        export: exportHook({ type: "TEAM", label: "team", read: readTeams }),
    },
    GROUP: {
        // Groups have no slash command; Edit walks Housing Menu -> Permissions
        // and Groups to the specific group's edit menu. Deletion is menu-driven
        // too, so there's no one-shot remove command.
        type: "GROUP",
        label: "Groups",
        icon: Icons.shield,
        items: getHouseGroups,
        scanned: houseGroupsScanned,
        scan: scanHouseGroups,
        scanInFlight: isGroupScanInFlight,
        deepRead: makeDeepRead("GROUP", "group", readGroups, isGroupScanInFlight),
        rowActions: [
            {
                label: "Edit",
                icon: Icons.pencil,
                run: (name) => runMenuTask("open group", (ctx) => openEditGroup(ctx, name)),
            },
        ],
        export: exportHook({ type: "GROUP", label: "group", read: readGroups }),
    },
    NPC: {
        // NPCs are identified by position, not name, and have no per-NPC slash
        // command: Edit walks the /hmenu -> Systems -> NPCs browser to the NPC's
        // editor, Teleport right-clicks its slot. Export and deep read run
        // through `readNpcs`, position-keying the selected rows onto
        // `exportAllNpcs`.
        type: "NPC",
        label: "NPCs",
        icon: Icons.user,
        items: getHouseNpcs,
        scanned: houseNpcsScanned,
        scan: scanHouseNpcs,
        scanInFlight: isNpcScanInFlight,
        deepRead: makeDeepRead("NPC", "npc", readNpcs, isNpcScanInFlight),
        rowActions: [
            {
                label: "Edit",
                icon: Icons.pencil,
                run: (name) =>
                    runMenuTask("open NPC editor", (ctx) =>
                        openNpcEditorForPos(ctx, parseNpcPosIdentity(name))
                    ),
            },
            {
                label: "Teleport",
                icon: Icons.mapPin,
                run: (name) =>
                    runMenuTask("teleport to NPC", (ctx) =>
                        teleportToNpc(ctx, parseNpcPosIdentity(name))
                    ),
            },
        ],
        export: exportHook({ type: "NPC", label: "npc", read: readNpcs }),
    },
};

export const HOUSE_CONTENT_TYPES: HouseContentType[] =
    (Object.keys(HOUSE_CONTENT_BY_TYPE) as HouseReadableType[]).map(
        (type) => HOUSE_CONTENT_BY_TYPE[type]
    );

// Importable types with a house-side listing (the scan/enumerate path above).
// ITEM is absent: an item has no name-shaped house scan that can answer "is it
// in the house?" (it exists only where an action or menu references it). NPCs
// ARE listable (by position), so they're scannable; presence UI still gates on
// this membership.
const SCANNABLE_TYPES = new Set<Importable["type"]>();
for (let i = 0; i < HOUSE_CONTENT_TYPES.length; i++) {
    SCANNABLE_TYPES.add(HOUSE_CONTENT_TYPES[i].type);
}

export function isScannableType(type: Importable["type"]): boolean {
    return SCANNABLE_TYPES.has(type);
}
