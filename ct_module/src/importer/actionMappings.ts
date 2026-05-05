import type { Action, ActionChangeVar } from "htsw/types";

import type { ItemSlot } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import {
    parseLoreFields,
    parseLoreKeyValueLine,
    readListItemNote,
} from "./loreParsing";
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
                default: true,
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
            Subtitle: { prop: "subtitle", kind: "value", default: "" },
            Fadein: { prop: "fadein", kind: "value", default: 1 },
            Stay: { prop: "stay", kind: "value", default: 5 },
            Fadeout: { prop: "fadeout", kind: "value", default: 1 },
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
            "Allow Multiple": { prop: "allowMultiple", kind: "boolean", default: false },
            "Inventory Slot": {
                prop: "slot",
                kind: "select",
                default: "First Available Slot",
            },
            "Replace Existing Item": {
                prop: "replaceExisting",
                kind: "boolean",
                default: false,
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
            Duration: { prop: "duration", kind: "value", default: 60 },
            Level: { prop: "level", kind: "value", default: 1 },
            "Override Existing Effects": {
                prop: "override",
                kind: "boolean",
                default: false,
            },
            "Show Potion Icon": { prop: "showIcon", kind: "boolean", default: true },
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
                default: false,
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
            Volume: { prop: "volume", kind: "value", default: 0.7 },
            Pitch: { prop: "pitch", kind: "value", default: 1.0 },
            Location: { prop: "location", kind: "select", default: "Not Set" },
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
            "Trigger For All Players": {
                prop: "global",
                kind: "boolean",
                default: false,
            },
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
            "Location": { prop: "location", kind: "select", default: "Not Set" },
            "Drop Naturally": { prop: "dropNaturally", kind: "boolean", default: true },
            "Prevent Item Merging": {
                prop: "disableMerging",
                kind: "boolean",
                default: false,
            },
            "Despawn Duration Ticks": {
                prop: "despawnDurationTicks",
                kind: "value",
                default: 6000,
            },
            "Pickup Delay Ticks": {
                prop: "pickupDelayTicks",
                kind: "value",
                default: 10,
            },
            "Prioritize Player": {
                prop: "prioritizePlayer",
                kind: "boolean",
                default: false,
            },
            "Fallback To Inventory": {
                prop: "inventoryFallback",
                kind: "boolean",
                default: false,
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
    return ACTION_MAPPINGS[type].loreFields;
}

/**
 * Returns the GUI default for a single action lore field, or undefined if
 * the type/prop combination doesn't exist or has no declared default.
 * Used by normalizeActionCompare to treat a default-valued observed field
 * as equivalent to an omitted field in desired source.
 */
export function getActionFieldDefault(type: string, prop: string): unknown {
    return getActionFieldSpec(type, prop)?.default;
}

export function getActionFieldKind(type: string, prop: string): UiFieldKind | undefined {
    return getActionFieldSpec(type, prop)?.kind;
}

function getActionFieldSpec(
    type: string,
    prop: string
): { prop: string; kind: UiFieldKind; default?: unknown } | undefined {
    const mapping = (
        ACTION_MAPPINGS as Record<
            string,
            | {
                  loreFields: Record<
                      string,
                      { prop: string; kind: UiFieldKind; default?: unknown }
                  >;
              }
            | undefined
        >
    )[type];
    if (!mapping) return undefined;
    for (const label in mapping.loreFields) {
        const field = mapping.loreFields[label];
        if (field.prop === prop) return field;
    }
    return undefined;
}

/**
 * Returns the Housing GUI slot label for the given action type + property.
 * Writers should use this instead of hardcoding labels so the mapping
 * stays the single source of truth for both reads and writes.
 *
 * Throws if the property has no matching label in the mapping — that
 * almost always means the mapping is missing a field, not that the
 * caller passed a bad prop, since `prop` is type-checked against the
 * action's data keys.
 */
export function getActionFieldLabel<T extends Action["type"]>(
    type: T,
    prop: Exclude<keyof Extract<Action, { type: T }>, "type" | "note">
): string {
    const mapping = ACTION_MAPPINGS[type];
    const loreFields = mapping.loreFields as Record<string, { prop: string }>;
    for (const label in loreFields) {
        if (loreFields[label].prop === prop) return label;
    }
    throw new Error(`No GUI label found for ${type}.${String(prop)} in ACTION_MAPPINGS`);
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

export function getActionScalarLoreFields(
    type: Action["type"]
): { prop: string; kind: UiFieldKind }[] {
    const loreFields = getActionLoreFields(type);
    const result: { prop: string; kind: UiFieldKind }[] = [];
    for (const label in loreFields) {
        const field = loreFields[label];
        if (field.kind !== "nestedList") {
            result.push({ prop: field.prop, kind: field.kind });
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
            ACTION_MAPPINGS[type as Action["type"]].displayName === normalizedDisplayName
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

    // CHANGE_VAR holder is parsed as a string from lore but the type expects
    // { type: string, team?: string }. When holder = Team the lore also has
    // a "Team: <name>" line; pull it out here so the holder is fully formed.
    if (action.type === "CHANGE_VAR") {
        const holder = (action as any).holder as string | undefined;
        if (holder === "Player" || holder === "Global") {
            (action as ActionChangeVar).holder = { type: holder };
        } else if (holder === "Team") {
            let team: string | undefined;
            for (const line of slot.getItem().getLore()) {
                const kv = parseLoreKeyValueLine(line);
                if (kv !== null && kv.label === "Team") {
                    team = removedFormatting(kv.value).trim();
                    break;
                }
            }
            (action as ActionChangeVar).holder =
                team === undefined ? { type: "Team" } : { type: "Team", team };
        }
    }

    return action;
}
