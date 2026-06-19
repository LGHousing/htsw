import type {
    Comparison,
    Value,
    Gamemode,
    VarName,
    Permission,
    ItemLocation,
    PotionEffect,
    ItemProperty,
    VarHolder,
    ItemAmount,
    DamageCause,
    FishingEnvironment,
    PortalType,
} from "./types";

export type ConditionRequireGroup = {
    type: "REQUIRE_GROUP";
    group?: string;
    includeHigherGroups?: boolean;
};

export type ConditionCompareVar = {
    type: "COMPARE_VAR";
    holder?: VarHolder;
    var?: VarName;
    op?: Comparison;
    amount?: Value;
    fallback?: Value;
};

export type ConditionRequirePermission = {
    type: "REQUIRE_PERMISSION";
    permission?: Permission;
};

export type ConditionIsInRegion = {
    type: "IS_IN_REGION";
    region?: string;
};

export type ConditionRequireItem = {
    type: "REQUIRE_ITEM";
    itemName?: string;
    whatToCheck?: ItemProperty;
    whereToCheck?: ItemLocation;
    amount?: ItemAmount;
};

export type ConditionIsDoingParkour = {
    type: "IS_DOING_PARKOUR";
};

export type ConditionRequirePotionEffect = {
    type: "REQUIRE_POTION_EFFECT";
    effect?: PotionEffect;
};

export type ConditionIsSneaking = {
    type: "IS_SNEAKING";
};

export type ConditionIsFlying = {
    type: "IS_FLYING";
};

export type ConditionCompareHealth = {
    type: "COMPARE_HEALTH";
    op?: Comparison;
    amount?: Value;
};

export type ConditionCompareMaxHealth = {
    type: "COMPARE_MAX_HEALTH";
    op?: Comparison;
    amount?: Value;
};

export type ConditionCompareHunger = {
    type: "COMPARE_HUNGER";
    op?: Comparison;
    amount?: Value;
};

export type ConditionRequireGamemode = {
    type: "REQUIRE_GAMEMODE";
    gamemode?: Gamemode;
};

export type ConditionComparePlaceholder = {
    type: "COMPARE_PLACEHOLDER";
    placeholder?: string;
    op?: Comparison;
    amount?: Value;
};

export type ConditionRequireTeam = {
    type: "REQUIRE_TEAM";
    team?: string;
};

export type ConditionDamageCause = {
    type: "DAMAGE_CAUSE";
    cause?: DamageCause;
};

export type ConditionPvpEnabled = {
    type: "PVP_ENABLED";
};

export type ConditionFishingEnvironment = {
    type: "FISHING_ENVIRONMENT";
    environment?: FishingEnvironment;
};

export type ConditionPortalType = {
    type: "PORTAL_TYPE";
    portalType?: PortalType;
};

export type ConditionBlockType = {
    type: "BLOCK_TYPE";
    itemName?: string;
};

export type ConditionIsItem = {
    type: "IS_ITEM";
    itemName?: string;
};

export type ConditionCompareDamage = {
    type: "COMPARE_DAMAGE";
    op?: Comparison;
    amount?: Value;
};

export type Condition = (
    | ConditionRequireGroup
    | ConditionCompareVar
    | ConditionRequirePermission
    | ConditionIsInRegion
    | ConditionRequireItem
    | ConditionIsDoingParkour
    | ConditionRequirePotionEffect
    | ConditionIsSneaking
    | ConditionIsFlying
    | ConditionCompareHealth
    | ConditionCompareMaxHealth
    | ConditionCompareHunger
    | ConditionRequireGamemode
    | ConditionComparePlaceholder
    | ConditionRequireTeam
    | ConditionDamageCause
    | ConditionPvpEnabled
    | ConditionFishingEnvironment
    | ConditionPortalType
    | ConditionBlockType
    | ConditionIsItem
    | ConditionCompareDamage
) & {
    inverted?: boolean;
    note?: string;
};
