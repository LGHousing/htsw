// Per-action and per-condition argument metadata. Drives editor completions,
// snippets, and signature tooltips. Fields listed in parser order.

export type ActionFieldKind =
    | "boolean"
    | "string"
    | "number"
    | "value" // long/double/placeholder/string
    | "placeholder"
    | "varName"
    | "varOp"
    | "operation"
    | "comparison"
    | "item"
    | "slot"
    | "gamemode"
    | "lobby"
    | "potion"
    | "enchant"
    | "location"
    | "team"
    | "function"
    | "group"
    | "weather"
    | "time"
    | "ifMode"
    | "block" // nested action block — no inline suggestions
    | "itemProperty"
    | "itemLocation"
    | "itemAmount"
    | "permission"
    | "damageCause"
    | "fishingEnv"
    | "portal";

export type ActionFieldSpec = {
    name: string;
    kind: ActionFieldKind;
    optional?: boolean;
};

export type ActionSpec = {
    kw: string;
    fields: readonly ActionFieldSpec[];
};

const f = (name: string, kind: ActionFieldKind, optional = false): ActionFieldSpec => ({
    name,
    kind,
    optional,
});

const VAR_FIELDS = [
    f("name", "varName"),
    f("op", "varOp"),
    f("value", "value"),
    f("automaticUnset", "boolean", true),
] as const;

const TEAM_VAR_FIELDS = [
    f("name", "varName"),
    f("team", "team"),
    f("op", "varOp"),
    f("value", "value"),
    f("automaticUnset", "boolean", true),
] as const;

export const ACTION_SPECS: readonly ActionSpec[] = [
    { kw: "actionBar", fields: [f("message", "string")] },
    { kw: "applyLayout", fields: [f("layout", "string")] },
    {
        kw: "applyPotion",
        fields: [
            f("effect", "potion"),
            f("duration", "number"),
            f("level", "number"),
            f("override", "boolean"),
            f("showIcon", "boolean", true),
        ],
    },
    { kw: "balanceTeam", fields: [] },
    { kw: "cancelEvent", fields: [] },
    {
        kw: "changeHealth",
        fields: [f("op", "operation"), f("amount", "value")],
    },
    {
        kw: "changePlayerGroup",
        fields: [
            f("group", "string"),
            f("demotionProtection", "boolean", true),
        ],
    },
    {
        kw: "changeVelocity",
        fields: [f("x", "value"), f("y", "value"), f("z", "value")],
    },
    {
        kw: "chat",
        fields: [f("message", "string")],
    },
    { kw: "clearEffects", fields: [] },
    { kw: "closeMenu", fields: [] },
    { kw: "compassTarget", fields: [f("location", "location")] },
    { kw: "consumeItem", fields: [] },
    { kw: "displayMenu", fields: [f("menu", "string")] },
    {
        kw: "displayNametag",
        fields: [f("displayNametag", "boolean")],
    },
    {
        kw: "dropItem",
        fields: [
            f("itemName", "item"),
            f("location", "location", true),
            f("dropNaturally", "boolean", true),
            f("disableMerging", "boolean", true),
            f("prioritizePlayer", "boolean", true),
            f("inventoryFallback", "boolean", true),
            f("despawnDurationTicks", "value", true),
            f("pickupDelayTicks", "value", true),
        ],
    },
    {
        kw: "enchant",
        fields: [f("enchant", "enchant"), f("level", "number")],
    },
    { kw: "exit", fields: [] },
    { kw: "failParkour", fields: [f("message", "string")] },
    { kw: "fullHeal", fields: [] },
    {
        kw: "function",
        fields: [f("function", "function"), f("global", "boolean", true)],
    },
    { kw: "gamemode", fields: [f("gamemode", "gamemode")] },
    {
        kw: "giveItem",
        fields: [
            f("itemName", "item"),
            f("allowMultiple", "boolean", true),
            f("slot", "slot", true),
            f("replaceExisting", "boolean", true),
        ],
    },
    { kw: "globalstat", fields: VAR_FIELDS },
    { kw: "globalvar", fields: VAR_FIELDS },
    { kw: "houseSpawn", fields: [] },
    {
        kw: "hungerLevel",
        fields: [f("op", "operation"), f("amount", "value")],
    },
    {
        kw: "if",
        fields: [
            f("mode", "ifMode"),
            f("conditions", "block"),
            f("ifActions", "block"),
            f("elseActions", "block", true),
        ],
    },
    { kw: "kill", fields: [] },
    {
        kw: "launchTarget",
        fields: [f("location", "location"), f("strength", "number")],
    },
    { kw: "lobby", fields: [f("lobby", "lobby")] },
    {
        kw: "maxHealth",
        fields: [f("op", "operation"), f("amount", "value")],
    },
    { kw: "parkCheck", fields: [] },
    { kw: "pause", fields: [f("ticks", "number")] },
    {
        kw: "playerTime",
        fields: [f("time", "time")],
    },
    {
        kw: "playerWeather",
        fields: [f("weather", "weather")],
    },
    { kw: "random", fields: [f("actions", "block")] },
    { kw: "removeItem", fields: [f("itemName", "item")] },
    { kw: "resetInventory", fields: [] },
    { kw: "setTeam", fields: [f("team", "team")] },
    {
        kw: "sound",
        fields: [
            f("sound", "string"),
            f("volume", "number", true),
            f("pitch", "number", true),
            f("location", "location", true),
        ],
    },
    { kw: "stat", fields: VAR_FIELDS },
    { kw: "teamstat", fields: TEAM_VAR_FIELDS },
    { kw: "teamvar", fields: TEAM_VAR_FIELDS },
    {
        kw: "title",
        fields: [
            f("title", "string"),
            f("subtitle", "string", true),
            f("fadein", "number", true),
            f("stay", "number", true),
            f("fadeout", "number", true),
        ],
    },
    {
        kw: "tp",
        fields: [
            f("location", "location"),
            f("preventTeleportInsideBlocks", "boolean", true),
        ],
    },
    { kw: "var", fields: VAR_FIELDS },
    { kw: "xpLevel", fields: [f("amount", "value")] },
] as const;

const ACTION_SPECS_BY_KW = (() => {
    const map = new Map<string, ActionSpec>();
    for (const spec of ACTION_SPECS) map.set(spec.kw.toLowerCase(), spec);
    return map;
})();

export function getActionSpec(kw: string): ActionSpec | undefined {
    return ACTION_SPECS_BY_KW.get(kw.toLowerCase());
}

// e.g. `var <name> <op> <value> [automaticUnset]`
export function renderActionSignature(spec: ActionSpec): string {
    if (spec.fields.length === 0) return spec.kw;
    const args = spec.fields
        .map((field) => (field.optional ? `[${field.name}]` : `<${field.name}>`))
        .join(" ");
    return `${spec.kw} ${args}`;
}

// var/globalvar/teamvar are handled separately — fallback-arg shape doesn't fit.
const COMPARE_HEALTH_FIELDS = [
    f("op", "comparison"),
    f("amount", "value"),
] as const;

export type ConditionSpec = {
    kw: string;
    fields: readonly ActionFieldSpec[];
};

export const CONDITION_SPECS: readonly ConditionSpec[] = [
    { kw: "blockType", fields: [f("itemName", "item")] },
    {
        kw: "damageAmount",
        fields: [f("op", "comparison"), f("amount", "value")],
    },
    { kw: "damageCause", fields: [f("cause", "damageCause")] },
    { kw: "doingParkour", fields: [] },
    { kw: "fishingEnv", fields: [f("environment", "fishingEnv")] },
    { kw: "gamemode", fields: [f("gamemode", "gamemode")] },
    {
        kw: "hasGroup",
        fields: [
            f("group", "group"),
            f("includeHigherGroups", "boolean", true),
        ],
    },
    {
        kw: "hasItem",
        fields: [
            f("itemName", "item"),
            f("whatToCheck", "itemProperty", true),
            f("whereToCheck", "itemLocation", true),
            f("amount", "itemAmount", true),
        ],
    },
    { kw: "hasPermission", fields: [f("permission", "permission")] },
    { kw: "hasPotion", fields: [f("effect", "potion")] },
    { kw: "hasTeam", fields: [f("team", "team")] },
    { kw: "health", fields: COMPARE_HEALTH_FIELDS },
    { kw: "hunger", fields: COMPARE_HEALTH_FIELDS },
    { kw: "inRegion", fields: [f("region", "string")] },
    { kw: "isFlying", fields: [] },
    { kw: "isItem", fields: [f("itemName", "item")] },
    { kw: "isSneaking", fields: [] },
    { kw: "maxHealth", fields: COMPARE_HEALTH_FIELDS },
    { kw: "canPvp", fields: [] },
    {
        kw: "placeholder",
        fields: [
            f("placeholder", "placeholder"),
            f("op", "comparison"),
            f("amount", "value"),
            f("fallback", "value", true),
        ],
    },
    { kw: "portal", fields: [f("portalType", "portal")] },
] as const;

const CONDITION_SPECS_BY_KW = (() => {
    const map = new Map<string, ConditionSpec>();
    for (const spec of CONDITION_SPECS) map.set(spec.kw.toLowerCase(), spec);
    return map;
})();

export function getConditionSpec(kw: string): ConditionSpec | undefined {
    return CONDITION_SPECS_BY_KW.get(kw.toLowerCase());
}
