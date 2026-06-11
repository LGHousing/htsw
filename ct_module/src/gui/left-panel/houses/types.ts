/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";
import { Icons, type IconName } from "../../lib/icons.generated";
import type { HouseImportable } from "../../../importCache/cache";
import {
    deepReadHouseFunctions,
    getHouseFunctions,
    houseFunctionsScanned,
    isFunctionReadInFlight,
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
import { exportAllFunctions } from "../../../importables/functions/exportAll";
import { exportAllEvents } from "../../../importables/events/exportAll";
import { exportAllMenus } from "../../../importables/menus/exportAll";
import { startExport, type ExportSpec } from "../../right-panel/import-tab/importController";

// One browsable category of house contents (Functions, Events, Menus). The
// Houses view is fully generic over this: it never references a concrete type,
// it dispatches scan/list/edit/export through the active entry. Adding a type =
// one source module under houses/sources/ + one entry here.
export type HouseContentType = {
    type: Importable["type"];
    label: string;
    icon: IconName;
    items: (uuid: string | null) => HouseImportable[];
    scanned: (uuid: string | null) => boolean;
    scan: () => void;
    scanInFlight: () => boolean;
    // Deep read: pull every importable's full content from the house into the
    // cache as verified knowledge (slow; explicit). Present only for types with
    // a read implementation (FUNCTION today).
    deepRead?: () => void;
    deepReadInFlight?: () => boolean;
    edit?: (name: string) => void;
    remove?: (name: string) => void;
    run?: (name: string) => void;
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
        deepRead: deepReadHouseFunctions,
        deepReadInFlight: isFunctionReadInFlight,
        edit: (name) => ChatLib.command(`function edit ${name}`),
        remove: (name) => ChatLib.command(`function delete ${name}`),
        run: (name) => ChatLib.command(`function run ${name}`),
        export: exportHook({ type: "FUNCTION", label: "function", exportAll: exportAllFunctions }),
    },
    {
        // Events are a fixed enumerated set — no per-name edit command and no
        // create/delete, so this is browse + export only.
        type: "EVENT",
        label: "Events",
        icon: Icons.zap,
        items: getHouseEvents,
        scanned: houseEventsScanned,
        scan: scanHouseEvents,
        scanInFlight: isEventScanInFlight,
        export: exportHook({ type: "EVENT", label: "event", exportAll: exportAllEvents }),
    },
    {
        type: "MENU",
        label: "Menus",
        icon: Icons.squareMenu,
        items: getHouseMenus,
        scanned: houseMenusScanned,
        scan: scanHouseMenus,
        scanInFlight: isMenuScanInFlight,
        edit: (name) => ChatLib.command(`menu edit ${name}`),
        export: exportHook({ type: "MENU", label: "menu", exportAll: exportAllMenus }),
    },
    {
        // Browse + edit only: there's no region exporter (reading bounds is the
        // hard part), so no export hook.
        type: "REGION",
        label: "Regions",
        icon: Icons.cuboid,
        items: getHouseRegions,
        scanned: houseRegionsScanned,
        scan: scanHouseRegions,
        scanInFlight: isRegionScanInFlight,
        edit: (name) => ChatLib.command(`region edit ${name}`),
        remove: (name) => ChatLib.command(`region delete ${name}`),
    },
];
