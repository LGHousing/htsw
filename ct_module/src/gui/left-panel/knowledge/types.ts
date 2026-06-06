/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";
import { Icons, type IconName } from "../../lib/icons.generated";
import {
    getHouseFunctions,
    houseFunctionsScanned,
    scanHouseFunctions,
    type HouseItem,
} from "./houseItems";

export type KnowledgeType = {
    type: Importable["type"];
    label: string;
    icon: IconName;
    items: (uuid: string | null) => HouseItem[];
    scanned: (uuid: string | null) => boolean;
    scan: () => void;
    edit?: (name: string) => void;
    remove?: (name: string) => void;
    run?: (name: string) => void;
    // Whether items of this type can be exported into the loaded import.json.
    // Drives the checkbox + Export action bar. Export reads the live housing
    // menu, so it's only actually offered while standing in the house.
    exportable?: boolean;
};

export const KNOWLEDGE_TYPES: KnowledgeType[] = [
    {
        type: "FUNCTION",
        label: "Functions",
        icon: Icons.command,
        items: getHouseFunctions,
        scanned: houseFunctionsScanned,
        scan: scanHouseFunctions,
        edit: (name) => ChatLib.command(`function edit ${name}`),
        remove: (name) => ChatLib.command(`function delete ${name}`),
        run: (name) => ChatLib.command(`function run ${name}`),
        exportable: true,
    },
];
