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
import { readFunctions } from "../../../importables/functions/readFunctions";
import { readEvents } from "../../../importables/events/readEvents";
import { readMenus } from "../../../importables/menus/readMenus";
import { readRegions } from "../../../importables/regions/readRegions";
import { readCommands } from "../../../importables/commands/readCommands";
import { startExport, type ExportSpec } from "../../export/taskController";
import { makeDeepRead } from "./sources/deepRead";

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

export const HOUSE_CONTENT_TYPES: HouseContentType[] = [
    {
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
    {
        // Events are a fixed enumerated set: rows open the shared /eventactions
        // page because Housing has no per-name edit command or create/delete.
        type: "EVENT",
        label: "Events",
        icon: Icons.zap,
        items: getHouseEvents,
        scanned: houseEventsScanned,
        scan: scanHouseEvents,
        scanInFlight: isEventScanInFlight,
        deepRead: makeDeepRead("EVENT", "event", readEvents, isEventScanInFlight),
        rowActions: [
            {
                label: "Open /eventactions",
                icon: Icons.externalLink,
                run: () => ChatLib.command("eventactions"),
            },
        ],
        export: exportHook({ type: "EVENT", label: "event", read: readEvents }),
    },
    {
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
    {
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
    {
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
];

// Importable types with a house-side listing (the scan/enumerate path above).
// Types absent here, such as ITEM and NPC, do not have a name-shaped house
// scan that can answer "is it in the house?". Presence UI must gate on this.
const SCANNABLE_TYPES = new Set<Importable["type"]>();
for (let i = 0; i < HOUSE_CONTENT_TYPES.length; i++) {
    SCANNABLE_TYPES.add(HOUSE_CONTENT_TYPES[i].type);
}

export function isScannableType(type: Importable["type"]): boolean {
    return SCANNABLE_TYPES.has(type);
}
