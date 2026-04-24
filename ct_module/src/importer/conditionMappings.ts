import { CONDITION_NAMES, type Condition, type ConditionCompareVar } from "htsw/types";

import { ItemSlot } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import { parseLoreFields, readListItemNote } from "./helpers";
import type { ConditionLoreSpec } from "./types";

export const CONDITION_LORE_MAPPINGS = {
    REQUIRE_GROUP: {
        displayName: "Required Group",
        loreFields: {
            "Required Group": { prop: "group", kind: "value" },
            "Include Higher Groups": {
                prop: "includeHigherGroups",
                kind: "boolean",
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
            "Fallback Value": { prop: "fallback", kind: "value" },
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
            "What To Check": { prop: "whatToCheck", kind: "cycle" },
            "Where To Check": { prop: "whereToCheck", kind: "select" },
            "Required Amount": { prop: "amount", kind: "cycle" },
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
    [K in Condition["type"]]?: ConditionLoreSpec<Extract<Condition, { type: K }>>;
};

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
    const mapping = CONDITION_LORE_MAPPINGS[type];

    const condition = {
        type,
        ...commonFields,
        ...parseLoreFields(slot, mapping.loreFields),
    } as Condition;

    // COMPARE_VAR holder is parsed as a string from lore but the type expects { type: string }
    if (condition.type === "COMPARE_VAR") {
        const holder = (condition as any).holder as string | undefined;
        if (holder === "Player" || holder === "Global" || holder === "Team") {
            (condition as ConditionCompareVar).holder = { type: holder };
        }
    }

    return condition;
}
