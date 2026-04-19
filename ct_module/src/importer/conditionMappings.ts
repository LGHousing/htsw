import {
    CONDITION_NAMES,
    type Condition,
    type ConditionBlockType,
    type ConditionCompareDamage,
    type ConditionCompareHealth,
    type ConditionCompareHunger,
    type ConditionCompareMaxHealth,
    type ConditionComparePlaceholder,
    type ConditionCompareVar,
    type ConditionDamageCause,
    type ConditionFishingEnvironment,
    type ConditionIsDoingParkour,
    type ConditionIsItem,
    type ConditionIsFlying,
    type ConditionIsInRegion,
    type ConditionIsSneaking,
    type ConditionRequireGroup,
    type ConditionPortalType,
    type ConditionPvpEnabled,
    type ConditionRequireGamemode,
    type ConditionRequireItem,
    type ConditionRequirePermission,
    type ConditionRequirePotionEffect,
    type ConditionRequireTeam,
} from "htsw/types";

import { ItemSlot } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import { parseLoreFields } from "./helpers";
import type { ConditionLoreSpec } from "./types";

export const CONDITION_LORE_MAPPINGS = {
    REQUIRE_GROUP: {
        loreFields: {
            "Required Group": { prop: "group", kind: "value" },
            "Include Higher Groups": {
                prop: "includeHigherGroups",
                kind: "boolean",
            },
        },
    },

    COMPARE_VAR: {
        loreFields: {
            Holder: { prop: "holder", kind: "cycle" },
            Variable: { prop: "var", kind: "value" },
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
            "Fallback Value": { prop: "fallback", kind: "value" },
        },
    },

    REQUIRE_PERMISSION: {
        loreFields: {
            "Required Permission": { prop: "permission", kind: "select" },
        },
    },

    IS_IN_REGION: {
        loreFields: {
            Region: { prop: "region", kind: "select" },
        },
    },

    REQUIRE_ITEM: {
        loreFields: {
            Item: { prop: "itemName", kind: "item" },
            "What To Check": { prop: "whatToCheck", kind: "cycle" },
            "Where To Check": { prop: "whereToCheck", kind: "select" },
            "Required Amount": { prop: "amount", kind: "cycle" },
        },
    },

    IS_DOING_PARKOUR: {
        loreFields: {},
    },

    REQUIRE_POTION_EFFECT: {
        loreFields: {
            Effect: { prop: "effect", kind: "select" },
        },
    },

    IS_SNEAKING: {
        loreFields: {},
    },

    IS_FLYING: {
        loreFields: {},
    },

    COMPARE_HEALTH: {
        loreFields: {
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
        },
    },

    COMPARE_MAX_HEALTH: {
        loreFields: {
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
        },
    },

    COMPARE_HUNGER: {
        loreFields: {
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
        },
    },

    REQUIRE_GAMEMODE: {
        loreFields: {
            "Required Gamemode": { prop: "gamemode", kind: "cycle" },
        },
    },

    COMPARE_PLACEHOLDER: {
        loreFields: {
            Placeholder: { prop: "placeholder", kind: "value" },
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
        },
    },

    REQUIRE_TEAM: {
        loreFields: {
            "Required Team": { prop: "team", kind: "select" },
        },
    },

    DAMAGE_CAUSE: {
        loreFields: {
            Cause: { prop: "cause", kind: "select" },
        },
    },

    PVP_ENABLED: {
        loreFields: {},
    },

    FISHING_ENVIRONMENT: {
        loreFields: {
            Environment: { prop: "environment", kind: "cycle" },
        },
    },

    PORTAL_TYPE: {
        loreFields: {
            Type: { prop: "portalType", kind: "select" },
        },
    },

    BLOCK_TYPE: {
        loreFields: {
            Item: { prop: "itemName", kind: "item" },
        },
    },

    IS_ITEM: {
        loreFields: {
            Item: { prop: "itemName", kind: "item" },
        },
    },

    COMPARE_DAMAGE: {
        loreFields: {
            Comparator: { prop: "op", kind: "select" },
            "Compare Value": { prop: "amount", kind: "value" },
        },
    },
} satisfies {
    [K in Condition["type"]]?: ConditionLoreSpec<
        Extract<Condition, { type: K }>
    >;
};

export function tryGetConditionTypeFromDisplayName(
    displayName: string,
): Condition["type"] | undefined {
    const normalizedDisplayName = removedFormatting(displayName).trim();

    for (const type in CONDITION_NAMES) {
        if (
            CONDITION_NAMES[type as Condition["type"]] === normalizedDisplayName
        ) {
            return type as Condition["type"];
        }
    }

    return undefined;
}

type ConditionListBuilder<T extends Condition> = (slot: ItemSlot) => T;

type ConditionListBuilderMap = {
    [K in Condition["type"]]?: ConditionListBuilder<
        Extract<Condition, { type: K }>
    >;
};

function readStringField(
    fields: Partial<Record<string, string | boolean>>,
    key: string,
): string | undefined {
    const value = fields[key];
    return typeof value === "string" ? value : undefined;
}

function readBooleanField(
    fields: Partial<Record<string, string | boolean>>,
    key: string,
): boolean | undefined {
    const value = fields[key];
    return typeof value === "boolean" ? value : undefined;
}

const CONDITION_LIST_BUILDERS: ConditionListBuilderMap = {
    REQUIRE_GROUP: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.REQUIRE_GROUP.loreFields,
        );
        const group = readStringField(fields, "group");
        const includeHigherGroups = readBooleanField(
            fields,
            "includeHigherGroups",
        );

        const condition: ConditionRequireGroup = {
            type: "REQUIRE_GROUP",
        };

        if (group) {
            condition.group = group;
        }

        if (includeHigherGroups) {
            condition.includeHigherGroups = true;
        }

        return condition satisfies ConditionRequireGroup;
    },
    COMPARE_VAR: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.COMPARE_VAR.loreFields,
        );
        const holderType = readStringField(fields, "holder");
        let holder: ConditionCompareVar["holder"];

        if (holderType === "Player") {
            holder = { type: "Player" };
        } else if (holderType === "Global") {
            holder = { type: "Global" };
        } else if (holderType === "Team") {
            holder = { type: "Team" };
        }

        return {
            type: "COMPARE_VAR",
            holder,
            var: readStringField(fields, "var"),
            op: readStringField(fields, "op") as ConditionCompareVar["op"],
            amount: readStringField(fields, "amount"),
            fallback: readStringField(fields, "fallback"),
        } satisfies ConditionCompareVar;
    },
    REQUIRE_PERMISSION: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.REQUIRE_PERMISSION.loreFields,
        );

        return {
            type: "REQUIRE_PERMISSION",
            permission: readStringField(
                fields,
                "permission",
            ) as ConditionRequirePermission["permission"],
        } satisfies ConditionRequirePermission;
    },
    IS_IN_REGION: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.IS_IN_REGION.loreFields,
        );

        return {
            type: "IS_IN_REGION",
            region: readStringField(fields, "region"),
        } satisfies ConditionIsInRegion;
    },
    REQUIRE_ITEM: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.REQUIRE_ITEM.loreFields,
        );

        return {
            type: "REQUIRE_ITEM",
            itemName: readStringField(fields, "itemName"),
            whatToCheck: readStringField(
                fields,
                "whatToCheck",
            ) as ConditionRequireItem["whatToCheck"],
            whereToCheck: readStringField(
                fields,
                "whereToCheck",
            ) as ConditionRequireItem["whereToCheck"],
            amount: readStringField(
                fields,
                "amount",
            ) as ConditionRequireItem["amount"],
        } satisfies ConditionRequireItem;
    },
    IS_DOING_PARKOUR: () =>
        ({ type: "IS_DOING_PARKOUR" }) satisfies ConditionIsDoingParkour,
    REQUIRE_POTION_EFFECT: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.REQUIRE_POTION_EFFECT.loreFields,
        );

        return {
            type: "REQUIRE_POTION_EFFECT",
            effect: readStringField(
                fields,
                "effect",
            ) as ConditionRequirePotionEffect["effect"],
        } satisfies ConditionRequirePotionEffect;
    },
    IS_SNEAKING: () => ({ type: "IS_SNEAKING" }) satisfies ConditionIsSneaking,
    IS_FLYING: () => ({ type: "IS_FLYING" }) satisfies ConditionIsFlying,
    COMPARE_HEALTH: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.COMPARE_HEALTH.loreFields,
        );

        return {
            type: "COMPARE_HEALTH",
            op: readStringField(fields, "op") as ConditionCompareHealth["op"],
            amount: readStringField(fields, "amount"),
        } satisfies ConditionCompareHealth;
    },
    COMPARE_MAX_HEALTH: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.COMPARE_MAX_HEALTH.loreFields,
        );

        return {
            type: "COMPARE_MAX_HEALTH",
            op: readStringField(
                fields,
                "op",
            ) as ConditionCompareMaxHealth["op"],
            amount: readStringField(fields, "amount"),
        } satisfies ConditionCompareMaxHealth;
    },
    COMPARE_HUNGER: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.COMPARE_HUNGER.loreFields,
        );

        return {
            type: "COMPARE_HUNGER",
            op: readStringField(fields, "op") as ConditionCompareHunger["op"],
            amount: readStringField(fields, "amount"),
        } satisfies ConditionCompareHunger;
    },
    REQUIRE_GAMEMODE: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.REQUIRE_GAMEMODE.loreFields,
        );

        return {
            type: "REQUIRE_GAMEMODE",
            gamemode: readStringField(
                fields,
                "gamemode",
            ) as ConditionRequireGamemode["gamemode"],
        } satisfies ConditionRequireGamemode;
    },
    COMPARE_PLACEHOLDER: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.COMPARE_PLACEHOLDER.loreFields,
        );

        return {
            type: "COMPARE_PLACEHOLDER",
            placeholder: readStringField(fields, "placeholder"),
            op: readStringField(
                fields,
                "op",
            ) as ConditionComparePlaceholder["op"],
            amount: readStringField(fields, "amount"),
        } satisfies ConditionComparePlaceholder;
    },
    REQUIRE_TEAM: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.REQUIRE_TEAM.loreFields,
        );

        return {
            type: "REQUIRE_TEAM",
            team: readStringField(fields, "team"),
        } satisfies ConditionRequireTeam;
    },
    DAMAGE_CAUSE: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.DAMAGE_CAUSE.loreFields,
        );

        return {
            type: "DAMAGE_CAUSE",
            cause: readStringField(
                fields,
                "cause",
            ) as ConditionDamageCause["cause"],
        } satisfies ConditionDamageCause;
    },
    PVP_ENABLED: () => ({ type: "PVP_ENABLED" }) satisfies ConditionPvpEnabled,
    FISHING_ENVIRONMENT: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.FISHING_ENVIRONMENT.loreFields,
        );

        return {
            type: "FISHING_ENVIRONMENT",
            environment: readStringField(
                fields,
                "environment",
            ) as ConditionFishingEnvironment["environment"],
        } satisfies ConditionFishingEnvironment;
    },
    PORTAL_TYPE: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.PORTAL_TYPE.loreFields,
        );

        return {
            type: "PORTAL_TYPE",
            portalType: readStringField(
                fields,
                "portalType",
            ) as ConditionPortalType["portalType"],
        } satisfies ConditionPortalType;
    },
    BLOCK_TYPE: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.BLOCK_TYPE.loreFields,
        );

        return {
            type: "BLOCK_TYPE",
            itemName: readStringField(fields, "itemName"),
        } satisfies ConditionBlockType;
    },
    IS_ITEM: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.IS_ITEM.loreFields,
        );

        return {
            type: "IS_ITEM",
            itemName: readStringField(fields, "itemName"),
        } satisfies ConditionIsItem;
    },
    COMPARE_DAMAGE: (slot) => {
        const fields = parseLoreFields(
            slot,
            CONDITION_LORE_MAPPINGS.COMPARE_DAMAGE.loreFields,
        );

        return {
            type: "COMPARE_DAMAGE",
            op: readStringField(fields, "op") as ConditionCompareDamage["op"],
            amount: readStringField(fields, "amount"),
        } satisfies ConditionCompareDamage;
    },
};

export function parseConditionListItem(
    slot: ItemSlot,
    type: Condition["type"],
): Condition {
    const builder = CONDITION_LIST_BUILDERS[type];

    if (!builder) {
        throw new Error(`List parsing not implemented for "${type}" yet.`);
    }

    return builder(slot);
}
