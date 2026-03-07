import type { Action, Comparison, Location, Operation, Sound, VarOperation } from "htsw/types";
import {
    COMPARISONS,
    OPERATIONS,
    SOUNDS,
    VAR_OPERATIONS,
} from "htsw/types";

const ACTION_DISPLAY_ENTRIES: Array<[string, Action["type"]]> = [
    ["Change Variable", "CHANGE_VAR"],
    ["Conditional", "CONDITIONAL"],
    ["Send a Chat Message", "MESSAGE"],
    ["Play Sound", "PLAY_SOUND"],
    ["Give Item", "GIVE_ITEM"],
    ["Display Title", "TITLE"],
    ["Exit", "EXIT"],
    ["Change Player's Group", "SET_GROUP"],
    ["Kill Player", "KILL"],
    ["Full Heal", "HEAL"],
    ["Display Action Bar", "ACTION_BAR"],
    ["Reset Inventory", "RESET_INVENTORY"],
    ["Remove Item", "REMOVE_ITEM"],
    ["Apply Potion Effect", "APPLY_POTION_EFFECT"],
    ["Display Menu", "SET_MENU"],
    ["Set Player Team", "SET_TEAM"],
    ["Pause Execution", "PAUSE"],
    ["Enchant Held Item", "ENCHANT_HELD_ITEM"],
    ["Apply Inventory Layout", "APPLY_INVENTORY_LAYOUT"],
    ["Trigger Function", "FUNCTION"],
    ["Random Action", "RANDOM"],
    ["Set Gamemode", "SET_GAMEMODE"],
    ["Set Compass Target", "SET_COMPASS_TARGET"],
    ["Fail Parkour", "FAIL_PARKOUR"],
    ["Teleport Player", "TELEPORT"],
    ["Send to Lobby", "SEND_TO_LOBBY"],
    ["Give Experience Levels", "GIVE_EXPERIENCE_LEVELS"],
    ["Clear All Potion Effects", "CLEAR_POTION_EFFECTS"],
    ["Change Max Health", "CHANGE_MAX_HEALTH"],
    ["Change Health", "CHANGE_HEALTH"],
    ["Change Hunger Level", "CHANGE_HUNGER"],
    ["Drop Item", "DROP_ITEM"],
    ["Change Velocity", "SET_VELOCITY"],
    ["Launch to Target", "LAUNCH"],
    ["Cancel Event", "CANCEL_EVENT"],
];

const SORTED_ACTION_DISPLAY_ENTRIES = [...ACTION_DISPLAY_ENTRIES].sort(
    (a, b) => b[0].length - a[0].length
);

function normalize(value: string | null | undefined): string {
    return (value ?? "").trim();
}

export function mapActionDisplayName(displayName: string): Action["type"] | undefined {
    const normalized = normalize(displayName);
    if (!normalized) return undefined;

    const exact = ACTION_DISPLAY_ENTRIES.find(([display]) => display === normalized);
    if (exact) return exact[1];

    for (const [display, type] of SORTED_ACTION_DISPLAY_ENTRIES) {
        if (normalized.startsWith(display)) return type;
    }

    return undefined;
}

export function parseBooleanCurrentValue(value: string | null | undefined): boolean | undefined {
    const normalized = normalize(value).toLowerCase();
    if (!normalized) return undefined;

    if (normalized === "enabled" || normalized === "true" || normalized === "yes") return true;
    if (normalized === "disabled" || normalized === "false" || normalized === "no") return false;

    return undefined;
}

export function parseNumberCurrentValue(value: string | null | undefined): number | undefined {
    const normalized = normalize(value);
    if (!normalized) return undefined;

    const cleaned = normalized.replace(/,/g, "");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
}

function parseEnumOption<T extends string>(
    value: string | null | undefined,
    options: readonly T[]
): T | undefined {
    const normalized = normalize(value).toLowerCase();
    if (!normalized) return undefined;

    for (const option of options) {
        if (option.toLowerCase() === normalized) return option;
    }
    return undefined;
}

export function parseOperationCurrentValue(value: string | null | undefined): Operation | undefined {
    return parseEnumOption(value, OPERATIONS);
}

export function parseVarOperationCurrentValue(value: string | null | undefined): VarOperation | undefined {
    return parseEnumOption(value, [...OPERATIONS, ...VAR_OPERATIONS]);
}

export function parseComparisonCurrentValue(value: string | null | undefined): Comparison | undefined {
    return parseEnumOption(value, COMPARISONS);
}

export function parseSoundCurrentValue(value: string | null | undefined): Sound | undefined {
    const normalized = normalize(value).toLowerCase();
    if (!normalized) return undefined;

    for (const sound of SOUNDS) {
        if (sound.path.toLowerCase() === normalized) return sound.path;
        if (sound.name.toLowerCase() === normalized) return sound.path;
    }
    return undefined;
}

export function parseLocationCurrentValue(value: string | null | undefined): Location | undefined {
    const normalized = normalize(value);
    if (!normalized) return undefined;

    if (normalized === "House Spawn Location") {
        return { type: "House Spawn Location" };
    }
    if (normalized === "Invokers Location") {
        return { type: "Invokers Location" };
    }
    if (normalized === "Current Location") {
        return { type: "Current Location" };
    }

    if (normalized.startsWith("Custom Coordinates")) {
        const custom = normalized.slice("Custom Coordinates".length).trim();
        if (custom.length > 0) {
            return { type: "Custom Coordinates", value: custom };
        }
        return { type: "Custom Coordinates", value: "" };
    }

    return { type: "Custom Coordinates", value: normalized };
}
