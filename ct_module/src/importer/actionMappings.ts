import type { Action, ActionChangeVar } from "htsw/types";

import type { ItemSlot } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import { parseLoreFields, readListItemNote } from "./loreParsing";
import type { ActionLoreSpec, UiFieldKind } from "./types";

export const ACTION_MAPPINGS = {
    CONDITIONAL: {
        displayName: "Conditional",
        loreFields: {
            "Match Any Condition": { prop: "matchAny", kind: "boolean" },
            Conditions: { prop: "conditions", kind: "nestedList" },
            "If Actions": { prop: "ifActions", kind: "nestedList" },
            "Else Actions": { prop: "elseActions", kind: "nestedList" },
        },
    },

    SET_GROUP: {
        displayName: "Change Player's Group",
        loreFields: {
            Group: { prop: "group", kind: "value" },
            "Demotion Protection": {
                prop: "demotionProtection",
                kind: "boolean",
            },
        },
    },

    KILL: {
        displayName: "Kill Player",
        loreFields: {},
    },

    HEAL: {
        displayName: "Full Heal",
        loreFields: {},
    },

    TITLE: {
        displayName: "Display Title",
        loreFields: {
            Title: { prop: "title", kind: "value" },
            Subtitle: { prop: "subtitle", kind: "value" },
            Fadein: { prop: "fadein", kind: "value" },
            Stay: { prop: "stay", kind: "value" },
            Fadeout: { prop: "fadeout", kind: "value" },
        },
    },

    ACTION_BAR: {
        displayName: "Display Action Bar",
        loreFields: {
            Message: { prop: "message", kind: "value" },
        },
    },

    RESET_INVENTORY: {
        displayName: "Reset Inventory",
        loreFields: {},
    },

    CHANGE_MAX_HEALTH: {
        displayName: "Change Max Health",
        loreFields: {
            Mode: { prop: "op", kind: "select" },
            "Max Health": { prop: "amount", kind: "value" },
            "Heal On Change": { prop: "heal", kind: "boolean" },
        },
    },

    PARKOUR_CHECKPOINT: {
        displayName: "Parkour Checkpoint",
        loreFields: {},
    },

    GIVE_ITEM: {
        displayName: "Give Item",
        loreFields: {
            Item: { prop: "itemName", kind: "item" },
            "Allow Multiple": { prop: "allowMultiple", kind: "boolean" },
            "Inventory Slot": { prop: "slot", kind: "select" },
            "Replace Existing Item": {
                prop: "replaceExisting",
                kind: "boolean",
            },
        },
    },

    REMOVE_ITEM: {
        displayName: "Remove Item",
        loreFields: {
            Item: { prop: "itemName", kind: "item" },
        },
    },

    MESSAGE: {
        displayName: "Send a Chat Message",
        loreFields: {
            Message: { prop: "message", kind: "value" },
        },
    },

    APPLY_POTION_EFFECT: {
        displayName: "Apply Potion Effect",
        loreFields: {
            Effect: { prop: "effect", kind: "select" },
            Duration: { prop: "duration", kind: "value" },
            Level: { prop: "level", kind: "value" },
            "Override Existing Effects": { prop: "override", kind: "boolean" },
            "Show Potion Icon": { prop: "showIcon", kind: "boolean" },
        },
    },

    CLEAR_POTION_EFFECTS: {
        displayName: "Clear All Potion Effects",
        loreFields: {},
    },

    GIVE_EXPERIENCE_LEVELS: {
        displayName: "Give Experience Levels",
        loreFields: {
            Levels: { prop: "amount", kind: "value" },
        },
    },

    SEND_TO_LOBBY: {
        displayName: "Send to Lobby",
        loreFields: {
            Location: { prop: "lobby", kind: "select" },
        },
    },

    CHANGE_VAR: {
        displayName: "Change Variable",
        loreFields: {
            Holder: { prop: "holder", kind: "cycle" },
            Variable: { prop: "key", kind: "value" },
            Operation: { prop: "op", kind: "select" },
            Value: { prop: "value", kind: "value" },
            "Automatic Unset": { prop: "unset", kind: "boolean", default: false },
        },
    },

    TELEPORT: {
        displayName: "Teleport Player",
        loreFields: {
            Location: { prop: "location", kind: "select" },
            "Prevent Teleport Inside Blocks": {
                prop: "preventTeleportInsideBlocks",
                kind: "boolean",
            },
        },
    },

    FAIL_PARKOUR: {
        displayName: "Fail Parkour",
        loreFields: {
            Reason: { prop: "message", kind: "value" },
        },
    },

    PLAY_SOUND: {
        displayName: "Play Sound",
        loreFields: {
            Sound: { prop: "sound", kind: "select" },
            Volume: { prop: "volume", kind: "value" },
            Pitch: { prop: "pitch", kind: "value" },
            Location: { prop: "location", kind: "select" },
        },
    },

    SET_COMPASS_TARGET: {
        displayName: "Set Compass Target",
        loreFields: {
            Location: { prop: "location", kind: "select" },
        },
    },

    SET_GAMEMODE: {
        displayName: "Set Gamemode",
        loreFields: {
            Gamemode: { prop: "gamemode", kind: "select" },
        },
    },

    CHANGE_HEALTH: {
        displayName: "Change Health",
        loreFields: {
            Mode: { prop: "op", kind: "select" },
            Health: { prop: "amount", kind: "value" },
        },
    },

    CHANGE_HUNGER: {
        displayName: "Change Hunger Level",
        loreFields: {
            Mode: { prop: "op", kind: "select" },
            Level: { prop: "amount", kind: "value" },
        },
    },

    RANDOM: {
        displayName: "Random Action",
        loreFields: {
            Actions: { prop: "actions", kind: "nestedList" },
        },
    },

    FUNCTION: {
        displayName: "Trigger Function",
        loreFields: {
            Function: { prop: "function", kind: "value" },
            "Trigger For All Players": { prop: "global", kind: "boolean" },
        },
    },

    APPLY_INVENTORY_LAYOUT: {
        displayName: "Apply Inventory Layout",
        loreFields: {
            Layout: { prop: "layout", kind: "select" },
        },
    },

    ENCHANT_HELD_ITEM: {
        displayName: "Enchant Held Item",
        loreFields: {
            Enchantment: { prop: "enchant", kind: "select" },
            Level: { prop: "level", kind: "value" },
        },
    },

    PAUSE: {
        displayName: "Pause Execution",
        loreFields: {
            "Ticks To Wait": { prop: "ticks", kind: "value" },
        },
    },

    SET_TEAM: {
        displayName: "Set Player Team",
        loreFields: {
            Team: { prop: "team", kind: "select" },
        },
    },

    SET_MENU: {
        displayName: "Display Menu",
        loreFields: {
            Menu: { prop: "menu", kind: "select" },
        },
    },

    CLOSE_MENU: {
        displayName: "Close Menu",
        loreFields: {},
    },

    DROP_ITEM: {
        displayName: "Drop Item",
        loreFields: {
            "Item": { prop: "itemName", kind: "item" },
            "Location": { prop: "location", kind: "select" },
            "Drop Naturally": { prop: "dropNaturally", kind: "boolean" },
            "Prevent Item Merging": { prop: "disableMerging", kind: "boolean" },
            "Despawn Duration Ticks": {
                prop: "despawnDurationTicks",
                kind: "value",
            },
            "Pickup Delay Ticks": { prop: "pickupDelayTicks", kind: "value" },
            "Prioritize Player": {
                prop: "prioritizePlayer",
                kind: "boolean",
            },
            "Fallback To Inventory": {
                prop: "inventoryFallback",
                kind: "boolean",
            },
        },
    },

    SET_VELOCITY: {
        displayName: "Change Velocity",
        loreFields: {
            "X Direction": { prop: "x", kind: "value" },
            "Y Direction": { prop: "y", kind: "value" },
            "Z Direction": { prop: "z", kind: "value" },
        },
    },

    LAUNCH: {
        displayName: "Launch to Target",
        loreFields: {
            "Target Location": { prop: "location", kind: "select" },
            "Launch Strength": { prop: "strength", kind: "value" },
        },
    },

    SET_PLAYER_WEATHER: {
        displayName: "Set Player Weather",
        loreFields: {
            Weather: { prop: "weather", kind: "select" },
        },
    },

    SET_PLAYER_TIME: {
        displayName: "Set Player Time",
        loreFields: {
            Time: { prop: "time", kind: "cycle" },
        },
    },

    TOGGLE_NAMETAG_DISPLAY: {
        displayName: "Toggle Nametag Display",
        loreFields: {
            "Display Nametag": {
                prop: "displayNametag",
                kind: "boolean",
            },
        },
    },

    USE_HELD_ITEM: {
        displayName: "Use/Remove Held Item",
        loreFields: {},
    },

    EXIT: {
        displayName: "Exit",
        loreFields: {},
    },

    CANCEL_EVENT: {
        displayName: "Cancel Event",
        loreFields: {},
    },
} satisfies {
    [K in Action["type"]]: ActionLoreSpec<Extract<Action, { type: K }>>;
};

export function getActionLoreFields(
    type: Action["type"]
): Record<string, { prop: string; kind: UiFieldKind; default?: unknown }> {
    return ACTION_MAPPINGS[type].loreFields as Record<
        string,
        { prop: string; kind: UiFieldKind; default?: unknown }
    >;
}

/**
 * Returns the GUI default for a single action lore field, or undefined if
 * the type/prop combination doesn't exist or has no declared default.
 * Used by normalizeActionCompare to treat a default-valued observed field
 * as equivalent to an omitted field in desired source.
 */
export function getActionFieldDefault(type: string, prop: string): unknown {
    const mapping = (ACTION_MAPPINGS as Record<string, { loreFields: Record<string, { prop: string; kind: UiFieldKind; default?: unknown }> } | undefined>)[type];
    if (!mapping) return undefined;
    for (const label in mapping.loreFields) {
        const field = mapping.loreFields[label];
        if (field.prop === prop) return field.default;
    }
    return undefined;
}

export function getNestedListFields(
    type: Action["type"]
): { label: string; prop: string }[] {
    const loreFields = getActionLoreFields(type);
    const result: { label: string; prop: string }[] = [];
    for (const label in loreFields) {
        if (loreFields[label].kind === "nestedList") {
            result.push({ label, prop: loreFields[label].prop });
        }
    }
    return result;
}

export function tryGetActionTypeFromDisplayName(
    displayName: string
): Action["type"] | undefined {
    const normalizedDisplayName = removedFormatting(displayName).trim();

    for (const type in ACTION_MAPPINGS) {
        if (
            ACTION_MAPPINGS[type as Action["type"]].displayName ===
            normalizedDisplayName
        ) {
            return type as Action["type"];
        }
    }

    return undefined;
}

export function parseActionListItem(slot: ItemSlot, type: Action["type"]): Action {
    const note = readListItemNote(slot);
    const commonFields = note === undefined ? {} : { note };
    const mapping = ACTION_MAPPINGS[type];

    const action = {
        type,
        ...commonFields,
        ...parseLoreFields(slot, mapping.loreFields),
    } as Action;

    // CHANGE_VAR holder is parsed as a string from lore but the type expects { type: string }
    if (action.type === "CHANGE_VAR") {
        const holder = (action as any).holder as string | undefined;
        if (holder === "Player" || holder === "Global" || holder === "Team") {
            (action as ActionChangeVar).holder = { type: holder };
        }
    }

    return action;
}
