/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";
import { Icons, type IconName } from "../../lib/icons.generated";
import type { HouseItem } from "../../../houseContents/store";
import {
    getHouseFunctions,
    houseFunctionsScanned,
    isFunctionScanInFlight,
    scanHouseFunctions,
} from "../../../houseContents/functionsSource";
import {
    getHouseEvents,
    houseEventsScanned,
    isEventScanInFlight,
    scanHouseEvents,
} from "../../../houseContents/eventsSource";
import {
    getHouseMenus,
    houseMenusScanned,
    isMenuScanInFlight,
    scanHouseMenus,
} from "../../../houseContents/menusSource";
import {
    getHouseRegions,
    houseRegionsScanned,
    isRegionScanInFlight,
    scanHouseRegions,
} from "../../../houseContents/regionsSource";
import { exportAllFunctions } from "../../../importables/functions/exportAll";
import { exportAllEvents } from "../../../importables/events/exportAll";
import { exportAllMenus } from "../../../importables/menus/exportAll";
import { startExport, type ExportSpec } from "../../right-panel/import-tab/importController";

// One browsable category of house contents (Functions, Events, Menus). The
// Houses view is fully generic over this: it never references a concrete type,
// it dispatches scan/list/edit/export through the active entry. Adding a type =
// one source module under houseContents/ + one entry here.
export type HouseContentType = {
    type: Importable["type"];
    label: string;
    icon: IconName;
    items: (uuid: string | null) => HouseItem[];
    scanned: (uuid: string | null) => boolean;
    scan: () => void;
    scanInFlight: () => boolean;
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
        edit: (name) => ChatLib.command(`function edit ${name}`),
        remove: (name) => ChatLib.command(`function delete ${name}`),
        run: (name) => ChatLib.command(`function run ${name}`),
        export: exportHook({ label: "function", exportAll: exportAllFunctions }),
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
        export: exportHook({ label: "event", exportAll: exportAllEvents }),
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
        export: exportHook({ label: "menu", exportAll: exportAllMenus }),
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
