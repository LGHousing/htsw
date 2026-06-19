export const IMPORT_JSON_SCHEMA_DEFINITION_NAMES = [
    "importJsonPath",
    "htslPath",
    "snbtPath",
    "itemImportable",
    "functionImportable",
    "functionIcon",
    "eventImportable",
    "pos",
    "bounds",
    "regionImportable",
    "npcSkin",
    "npcEquipment",
    "npcImportable",
    "menuImportable",
    "menuSlot",
] as const;

export type ImportJsonSchemaDefinitionName = typeof IMPORT_JSON_SCHEMA_DEFINITION_NAMES[number];

export type SchemaSpec =
    | StringSchemaSpec
    | NumberSchemaSpec
    | BooleanSchemaSpec
    | ArraySchemaSpec
    | ObjectSchemaSpec
    | RefSchemaSpec;

export type SchemaPropertySpec = SchemaSpec & {
    required: boolean;
};

export type StringSchemaSpec = {
    kind: "string";
    pattern?: string;
    description?: string;
    enum?: readonly string[];
};

export type NumberSchemaSpec = {
    kind: "number";
    integer?: boolean;
    minimum?: number;
    maximum?: number;
    description?: string;
};

export type BooleanSchemaSpec = {
    kind: "boolean";
    description?: string;
};

export type ArraySchemaSpec = {
    kind: "array";
    items: SchemaSpec;
    description?: string;
};

export type ObjectSchemaSpec = {
    kind: "object";
    properties: Record<string, SchemaPropertySpec>;
    description?: string;
};

export type RefSchemaSpec = {
    kind: "ref";
    ref: ImportJsonSchemaDefinitionName;
    description?: string;
};

export const EVENTS = [
    "Player Join",
    "Player Quit",
    "Player Death",
    "Player Kill",
    "Player Respawn",
    "Group Change",
    "PvP State Change",
    "Fish Caught",
    "Player Enter Portal",
    "Player Damage",
    "Player Block Break",
    "Start Parkour",
    "Complete Parkour",
    "Player Drop Item",
    "Player Pick Up Item",
    "Player Change Held Item",
    "Player Toggle Sneak",
    "Player Toggle Flight",
] as const;

// Default Housing icon item per event, mirroring the items shown in the
// in-game "Event Actions" menu. Events carry no per-entry icon (unlike
// functions), so importable browsers render an event's icon from this map.
export const EVENT_ICONS: Record<(typeof EVENTS)[number], string> = {
    "Player Join": "minecraft:wooden_door",
    "Player Quit": "minecraft:dark_oak_door",
    "Player Death": "minecraft:bone",
    "Player Kill": "minecraft:diamond_sword",
    "Player Respawn": "minecraft:apple",
    "Group Change": "minecraft:paper",
    "PvP State Change": "minecraft:iron_sword",
    "Fish Caught": "minecraft:fishing_rod",
    "Player Enter Portal": "minecraft:obsidian",
    "Player Damage": "minecraft:lava_bucket",
    "Player Block Break": "minecraft:grass",
    "Start Parkour": "minecraft:light_weighted_pressure_plate",
    "Complete Parkour": "minecraft:light_weighted_pressure_plate",
    "Player Drop Item": "minecraft:dispenser",
    "Player Pick Up Item": "minecraft:hopper",
    "Player Change Held Item": "minecraft:book",
    "Player Toggle Sneak": "minecraft:hay_block",
    "Player Toggle Flight": "minecraft:feather",
};

export const NPC_SKINS = ["Steve", "Alex", "Players Skin"] as const;

export const IMPORT_JSON_SCHEMA = object({
    houseUuid: optional(string({
        pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        description: "Housing UUID binding. Only the entry import.json's binding is used.",
    })),
    include: optional(array(ref("importJsonPath"))),
    functions: optional(array(ref("functionImportable"))),
    events: optional(array(ref("eventImportable"))),
    regions: optional(array(ref("regionImportable"))),
    items: optional(array(ref("itemImportable"), {
        description: "Reusable item definitions. HTSL item fields may reference these by name, or may reference .snbt files directly.",
    })),
    menus: optional(array(ref("menuImportable"))),
    npcs: optional(array(ref("npcImportable"))),
});

export const IMPORT_JSON_SCHEMA_DEFINITIONS = {
    importJsonPath: string({
        pattern: "\\.?[iI][mM][pP][oO][rR][tT]\\.json$",
        description: "Relative import JSON file path ending in import.json or .import.json",
    }),
    htslPath: string({
        pattern: "\\.htsl$",
        description: "Relative HTSL file path ending in .htsl",
    }),
    snbtPath: string({
        pattern: "\\.snbt$",
        description: "Relative SNBT file path ending in .snbt",
    }),
    itemImportable: object({
        name: required(string({
            description: "Stable item reference name used from HTSL, for example: giveItem \"Activator Bail\"",
        })),
        nbt: required(ref("snbtPath")),
        leftClickActions: optional(ref("htslPath", {
            description: "Optional actions synced into this item's left-click action list.",
        })),
        rightClickActions: optional(ref("htslPath", {
            description: "Optional actions synced into this item's right-click action list.",
        })),
    }, {
        description: "A reusable item. The name is the stable reference used by HTSL item fields; nbt points to the SNBT file that defines the Minecraft item stack.",
    }),
    functionImportable: object({
        name: required(string()),
        actions: optional(ref("htslPath")),
        repeatTicks: optional(number({ minimum: 4, maximum: 18000 })),
        icon: optional(ref("functionIcon")),
    }),
    functionIcon: object({
        item: required(string({
            description: "Minecraft item id for the function icon, for example: minecraft:map",
        })),
        count: optional(integer({ minimum: 1, maximum: 64 })),
    }),
    eventImportable: object({
        event: required(string({ enum: EVENTS })),
        actions: required(ref("htslPath")),
    }),
    pos: object({
        x: required(number()),
        y: required(number()),
        z: required(number()),
    }),
    bounds: object({
        from: required(ref("pos")),
        to: required(ref("pos")),
    }),
    regionImportable: object({
        name: required(string()),
        bounds: optional(ref("bounds")),
        onEnterActions: optional(ref("htslPath")),
        onExitActions: optional(ref("htslPath")),
    }),
    npcSkin: string({ enum: NPC_SKINS }),
    npcEquipment: object({
        helmet: optional(ref("snbtPath")),
        chestplate: optional(ref("snbtPath")),
        leggings: optional(ref("snbtPath")),
        boots: optional(ref("snbtPath")),
        hand: optional(ref("snbtPath")),
    }),
    npcImportable: object({
        name: required(string()),
        pos: required(ref("pos")),
        leftClickActions: optional(ref("htslPath")),
        rightClickActions: optional(ref("htslPath")),
        lookAtPlayers: optional(boolean()),
        hideNameTag: optional(boolean()),
        skin: optional(ref("npcSkin")),
        equipment: optional(ref("npcEquipment")),
    }),
    menuImportable: object({
        name: required(string()),
        size: optional(integer({ minimum: 1, maximum: 6 })),
        slots: required(array(ref("menuSlot"))),
    }),
    menuSlot: object({
        slot: required(integer({ minimum: 0, maximum: 53 })),
        nbt: required(ref("snbtPath")),
        actions: optional(ref("htslPath")),
    }),
} as const satisfies Record<ImportJsonSchemaDefinitionName, SchemaSpec>;

export function definition(name: ImportJsonSchemaDefinitionName): ObjectSchemaSpec {
    const spec = IMPORT_JSON_SCHEMA_DEFINITIONS[name];
    if (spec.kind !== "object") throw new Error(`Schema definition '${name}' is not an object`);
    return spec;
}

function string(options: Omit<StringSchemaSpec, "kind"> = {}): StringSchemaSpec {
    return { kind: "string", ...options };
}

function number(options: Omit<NumberSchemaSpec, "kind" | "integer"> = {}): NumberSchemaSpec {
    return { kind: "number", ...options };
}

function integer(options: Omit<NumberSchemaSpec, "kind" | "integer"> = {}): NumberSchemaSpec {
    return { kind: "number", integer: true, ...options };
}

function boolean(options: Omit<BooleanSchemaSpec, "kind"> = {}): BooleanSchemaSpec {
    return { kind: "boolean", ...options };
}

function array(items: SchemaSpec, options: Omit<ArraySchemaSpec, "kind" | "items"> = {}): ArraySchemaSpec {
    return { kind: "array", items, ...options };
}

function object(
    properties: Record<string, SchemaPropertySpec>,
    options: Omit<ObjectSchemaSpec, "kind" | "properties"> = {},
): ObjectSchemaSpec {
    return { kind: "object", properties, ...options };
}

function ref(
    refName: ImportJsonSchemaDefinitionName,
    options: Omit<RefSchemaSpec, "kind" | "ref"> = {},
): RefSchemaSpec {
    return { kind: "ref", ref: refName, ...options };
}

function required<T extends SchemaSpec>(spec: T): T & { required: true } {
    return { ...spec, required: true };
}

function optional<T extends SchemaSpec>(spec: T): T & { required: false } {
    return { ...spec, required: false };
}
