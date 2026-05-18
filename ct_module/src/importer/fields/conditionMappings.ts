import { CONDITION_NAMES, type Condition, type ConditionCompareVar } from "htsw/types";

import { ItemSlot } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import {
    parseHolderField,
    parseLoreFields,
    readListItemNote,
} from "./loreParsing";
import type { ConditionLoreSpec, UiFieldKind } from "../types";

export const CONDITION_MAPPINGS = {
    REQUIRE_GROUP: {
        displayName: "Required Group",
        loreFields: {
            "Required Group": { prop: "group", kind: "value" },
            "Include Higher Groups": {
                prop: "includeHigherGroups",
                kind: "boolean",
                default: false,
            },
        },
    },

    COMPARE_VAR: {
        displayName: "Variable Requirement",
        loreFields: {
            Holder: { prop: "holder", kind: "cycle" },
            Variable: { prop: "var", kind: "value" },
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
            "Fallback Value": { prop: "fallback", kind: "value", default: "Not Set" },
        },
    },

    REQUIRE_PERMISSION: {
        displayName: "Required Permission",
        loreFields: {
            "Required Permission": { prop: "permission", kind: "select" },
        },
    },

    IS_IN_REGION: {
        displayName: "Within Region",
        loreFields: {
            Region: { prop: "region", kind: "select" },
        },
    },

    REQUIRE_ITEM: {
        displayName: "Has Item",
        loreFields: {
            Item: { prop: "itemName", kind: "item" },
            "What To Check": { prop: "whatToCheck", kind: "cycle", default: "Metadata" },
            "Where To Check": {
                prop: "whereToCheck",
                kind: "select",
                default: "Anywhere",
            },
            "Required Amount": { prop: "amount", kind: "cycle", default: "Any Amount" },
        },
    },

    IS_DOING_PARKOUR: {
        displayName: "Doing Parkour",
        loreFields: {},
    },

    REQUIRE_POTION_EFFECT: {
        displayName: "Has Potion Effect",
        loreFields: {
            Effect: { prop: "effect", kind: "select" },
        },
    },

    IS_SNEAKING: {
        displayName: "Player Sneaking",
        loreFields: {},
    },

    IS_FLYING: {
        displayName: "Player Flying",
        loreFields: {},
    },

    COMPARE_HEALTH: {
        displayName: "Player Health",
        loreFields: {
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
        },
    },

    COMPARE_MAX_HEALTH: {
        displayName: "Max Player Health",
        loreFields: {
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
        },
    },

    COMPARE_HUNGER: {
        displayName: "Player Hunger",
        loreFields: {
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
        },
    },

    REQUIRE_GAMEMODE: {
        displayName: "Required Gamemode",
        loreFields: {
            "Required Gamemode": { prop: "gamemode", kind: "cycle" },
        },
    },

    COMPARE_PLACEHOLDER: {
        displayName: "Placeholder Number Requirement",
        loreFields: {
            Placeholder: { prop: "placeholder", kind: "value" },
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
        },
    },

    REQUIRE_TEAM: {
        displayName: "Required Team",
        loreFields: {
            "Required Team": { prop: "team", kind: "select" },
        },
    },

    DAMAGE_CAUSE: {
        displayName: "Damage Cause",
        loreFields: {
            Cause: { prop: "cause", kind: "select" },
        },
    },

    PVP_ENABLED: {
        displayName: "PvP Enabled",
        loreFields: {},
    },

    FISHING_ENVIRONMENT: {
        displayName: "Fishing Environment",
        loreFields: {
            Environment: { prop: "environment", kind: "cycle" },
        },
    },

    PORTAL_TYPE: {
        displayName: "Portal Type",
        loreFields: {
            Type: { prop: "portalType", kind: "select" },
        },
    },

    BLOCK_TYPE: {
        displayName: "Block Type",
        loreFields: {
            Item: { prop: "itemName", kind: "item" },
        },
    },

    IS_ITEM: {
        displayName: "Is Item",
        loreFields: {
            Item: { prop: "itemName", kind: "item" },
        },
    },

    COMPARE_DAMAGE: {
        displayName: "Damage Amount",
        loreFields: {
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
        },
    },
} satisfies {
    [K in Condition["type"]]: ConditionLoreSpec<Extract<Condition, { type: K }>>;
};

/**
 * Returns the GUI default for a single condition lore field, or undefined
 * if the type/prop combination doesn't exist or has no declared default.
 * Mirrors getActionFieldDefault for conditions.
 */
export function getConditionFieldDefault(type: string, prop: string): unknown {
    return getConditionFieldSpec(type, prop)?.default;
}

export function getConditionFieldKind(
    type: string,
    prop: string
): UiFieldKind | undefined {
    return getConditionFieldSpec(type, prop)?.kind;
}

function getConditionFieldSpec(
    type: string,
    prop: string
): { prop: string; kind: UiFieldKind; default?: unknown } | undefined {
    const mapping = (
        CONDITION_MAPPINGS as Record<
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
 * Returns the Housing GUI slot label for the given condition type +
 * property. Mirrors getActionFieldLabel — see that helper for rationale.
 */
export function getConditionFieldLabel<T extends Condition["type"]>(
    type: T,
    prop: Exclude<keyof Extract<Condition, { type: T }>, "type" | "note" | "inverted">
): string {
    const mapping = CONDITION_MAPPINGS[type];
    const loreFields = mapping.loreFields as Record<string, { prop: string }>;
    for (const label in loreFields) {
        if (loreFields[label].prop === prop) return label;
    }
    throw new Error(
        `No GUI label found for ${type}.${String(prop)} in CONDITION_MAPPINGS`
    );
}

export function tryGetConditionTypeFromDisplayName(
    displayName: string
): Condition["type"] | undefined {
    const normalizedDisplayName = removedFormatting(displayName).trim();

    for (const type in CONDITION_NAMES) {
        if (CONDITION_NAMES[type as Condition["type"]] === normalizedDisplayName) {
            return type as Condition["type"];
        }
    }

    return undefined;
}

export function parseConditionListItem(
    slot: ItemSlot,
    type: Condition["type"]
): Condition {
    const note = readListItemNote(slot);
    const commonFields = note === undefined ? {} : { note };
    const mapping = CONDITION_MAPPINGS[type];

    const condition = {
        type,
        ...commonFields,
        ...parseLoreFields(slot, mapping.loreFields),
    } as Condition;

    if (condition.type === "COMPARE_VAR") {
        const holder = parseHolderField(
            slot,
            (condition as Record<string, unknown>).holder
        );
        if (holder !== undefined) {
            (condition as ConditionCompareVar).holder = holder;
        }
    }

    return condition;
}
