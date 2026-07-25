import type { Importable } from "htsw/types";

export type ImportableMetadataEntry = {
    key: string;
    label: string;
    value: string;
    jsonPath: string[];
};

function formatPos(pos: { x: number; y: number; z: number }): string {
    return `${pos.x}, ${pos.y}, ${pos.z}`;
}

export function importableMetadataEntries(
    importable: Importable
): ImportableMetadataEntry[] {
    if (importable.type === "FUNCTION") {
        const entries: ImportableMetadataEntry[] = [
            {
                key: "repeatTicks",
                label: "Repeat",
                value:
                    importable.repeatTicks === undefined
                        ? "off"
                        : `${importable.repeatTicks}t`,
                jsonPath: ["repeatTicks"],
            },
            {
                key: "icon",
                label: "Icon",
                value: importable.icon?.item ?? "default",
                jsonPath: ["icon"],
            },
        ];
        if (importable.icon !== undefined) {
            entries.push({
                key: "iconCount",
                label: "Count",
                value: String(importable.icon.count ?? 1),
                jsonPath: ["icon", "count"],
            });
        }
        return entries;
    }
    if (importable.type === "COMMAND") {
        return [
            { key: "mode", label: "Mode", value: importable.mode ?? "Self", jsonPath: ["mode"] },
            {
                key: "requiredPriority",
                label: "Priority",
                value: String(importable.requiredPriority ?? 0),
                jsonPath: ["requiredPriority"],
            },
            {
                key: "listed",
                label: "Listed",
                value: (importable.listed ?? true) ? "true" : "false",
                jsonPath: ["listed"],
            },
        ];
    }
    if (importable.type === "REGION") {
        if (importable.bounds === undefined) {
            return [{ key: "bounds", label: "Bounds", value: "(not set)", jsonPath: ["bounds"] }];
        }
        return [
            { key: "boundsFrom", label: "From", value: formatPos(importable.bounds.from), jsonPath: ["bounds", "from"] },
            { key: "boundsTo", label: "To", value: formatPos(importable.bounds.to), jsonPath: ["bounds", "to"] },
        ];
    }
    if (importable.type === "MENU") {
        return [{
            key: "size",
            label: "Size",
            value: importable.size === undefined ? "default (6 rows)" : `${importable.size} rows`,
            jsonPath: ["size"],
        }];
    }
    if (importable.type === "NPC") {
        return [
            { key: "pos", label: "Pos", value: formatPos(importable.pos), jsonPath: ["pos"] },
            {
                key: "leftClickRedirect",
                label: "Redirect",
                value:
                    importable.leftClickRedirect === undefined
                        ? "default"
                        : importable.leftClickRedirect
                          ? "true"
                          : "false",
                jsonPath: ["leftClickRedirect"],
            },
        ];
    }
    if (importable.type === "ITEM") {
        return [{ key: "nbt", label: "NBT", value: "Item data", jsonPath: ["nbt"] }];
    }
    return [];
}

export function importableMetadataComparisonValue(
    importable: Importable,
    key: string
): unknown {
    switch (key) {
        case "repeatTicks":
            return importable.type === "FUNCTION" ? importable.repeatTicks : undefined;
        case "icon":
            return importable.type === "FUNCTION"
                ? normalizedFunctionIcon(importable.icon)
                : undefined;
        case "iconCount":
            return importable.type === "FUNCTION" ? importable.icon?.count ?? 1 : undefined;
        case "mode":
            return importable.type === "COMMAND" ? importable.mode ?? "Self" : undefined;
        case "requiredPriority":
            return importable.type === "COMMAND" ? importable.requiredPriority ?? 0 : undefined;
        case "listed":
            return importable.type === "COMMAND" ? importable.listed ?? true : undefined;
        case "bounds":
            return importable.type === "REGION" ? importable.bounds : undefined;
        case "boundsFrom":
            return importable.type === "REGION" ? importable.bounds?.from : undefined;
        case "boundsTo":
            return importable.type === "REGION" ? importable.bounds?.to : undefined;
        case "size":
            return importable.type === "MENU" ? importable.size : undefined;
        case "pos":
            return importable.type === "NPC" ? importable.pos : undefined;
        case "leftClickRedirect":
            return importable.type === "NPC" ? importable.leftClickRedirect : undefined;
        case "nbt":
            return importable.type === "ITEM" ? importable.nbt : undefined;
        default:
            return undefined;
    }
}

function normalizedFunctionIcon(
    icon: Extract<Importable, { type: "FUNCTION" }>["icon"]
): unknown {
    if (icon === undefined) return null;
    const item = icon.item.indexOf(":") < 0 ? `minecraft:${icon.item.toLowerCase()}` : icon.item;
    const normalized: Record<string, unknown> = { item };
    if ((icon.count ?? 1) !== 1) normalized.count = icon.count;
    if (icon.enchanted === true) normalized.enchanted = true;
    return item === "minecraft:map" && Object.keys(normalized).length === 1
        ? null
        : normalized;
}
