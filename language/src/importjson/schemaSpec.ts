import type {
    ChatSpeed,
    Color,
    CommandMode,
    DefaultGameMode,
    Event,
    Permission,
} from "../types/types.js";
import type { NpcSkin } from "../types/importables.js";

function completeValues<T>() {
    return <const Values extends readonly T[]>(
        values: Values &
            (Exclude<T, Values[number]> extends never
                ? unknown
                : { missing: Exclude<T, Values[number]> })
    ): Values => values;
}

const EVENTS = completeValues<Event>()([
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
]);
const COLORS = completeValues<Color>()([
    "Dark Blue",
    "Dark Green",
    "Dark Aqua",
    "Dark Red",
    "Dark Purple",
    "Gold",
    "Gray",
    "Dark Gray",
    "Blue",
    "Green",
    "Aqua",
    "Red",
    "Light Purple",
    "Yellow",
]);
const CHAT_SPEEDS = completeValues<ChatSpeed>()([
    "Off",
    "On",
    "Slow 1s",
    "Slow 2s",
    "Slow 3s",
    "Slow 5s",
    "Slow 10s",
    "Slow 15s",
    "Slow 30s",
    "Slow 45s",
    "Slow 60s",
]);
const DEFAULT_GAME_MODES = completeValues<DefaultGameMode>()([
    "ADVENTURE",
    "SURVIVAL",
    "CREATIVE",
]);
const COMMAND_MODES = completeValues<CommandMode>()(["Self", "Targeted"]);
const PERMISSIONS = completeValues<Permission>()([
    "Fly",
    "Wood Door",
    "Iron Door",
    "Wood Trap Door",
    "Iron Trap Door",
    "Fence Gate",
    "Button",
    "Lever",
    "Use Launch Pads",
    "/tp",
    "/tp Other Players",
    "Jukebox",
    "Kick",
    "Ban",
    "Mute",
    "Pet Spawning",
    "Build",
    "Offline Build",
    "Fluid",
    "Pro Tools",
    "Use Chests",
    "Use Ender Chests",
    "Item Editor",
    "Switch Game Mode",
    "Edit Variables",
    "Change Player Group",
    "Change Gamerules",
    "Housing Menu",
    "Team Chat Spy",
    "Edit Actions",
    "Edit Regions",
    "Edit Scoreboard",
    "Edit Event Actions",
    "Edit Commands",
    "Edit Functions",
    "Edit Inventory Layouts",
    "Edit Teams",
    "Edit Custom Menus",
    "View Analytics",
    "View Logger",
    "Item: Mailbox",
    "Item: Egg Hunt",
    "Item: Teleport Pad",
    "Item: Launch Pad",
    "Item: Action Pad",
    "Item: Hologram",
    "Item: NPCs",
    "Item: Action Button",
    "Item: Leaderboard",
    "Item: Trash Can",
    "Item: Biome Stick",
]);

export type RawFunctionIcon = {
    item: string;
    count?: number;
    enchanted?: boolean;
};

export type RawFunctionImportable = {
    name: string;
    actions?: string;
    repeatTicks?: number;
    icon?: RawFunctionIcon;
};

export type RawEventImportable = { event: Event; actions: string };
export type RawPos = { x: number; y: number; z: number };
export type RawBounds = { from: RawPos; to: RawPos };
export type RawRegionImportable = {
    name: string;
    bounds?: RawBounds;
    onEnterActions?: string;
    onExitActions?: string;
};
export type RawItemImportable = {
    name: string;
    nbt: string;
    leftClickActions?: string;
    rightClickActions?: string;
};
export type RawMenuSlot = { slot: number; nbt: string; actions?: string };
export type RawMenuImportable = {
    name: string;
    size?: number;
    slots: RawMenuSlot[];
};
type RawNpcSkin = NpcSkin;
const NPC_SKINS = completeValues<RawNpcSkin>()([
    "Steve",
    "Alex",
    "Players Skin",
]);
export type RawNpcEquipment = {
    helmet?: string;
    chestplate?: string;
    leggings?: string;
    boots?: string;
    hand?: string;
};
export type RawNpcImportable = {
    name: string;
    pos: RawPos;
    leftClickActions?: string;
    rightClickActions?: string;
    leftClickRedirect?: boolean;
    lookAtPlayers?: boolean;
    hideNameTag?: boolean;
    skin?: RawNpcSkin;
    equipment?: RawNpcEquipment;
};
export type RawTeamImportable = {
    name: string;
    tag?: string;
    color?: Color;
    friendlyFire?: boolean;
};
type RawPermissions = Partial<Record<Permission, boolean>>;
export type RawGroupImportable = {
    name: string;
    tag?: string;
    tagShownInChat?: boolean;
    color?: Color;
    priority?: number;
    permissions?: RawPermissions;
    chatSpeed?: ChatSpeed;
    defaultGameMode?: DefaultGameMode;
};
export type RawCommandImportable = {
    name: string;
    actions?: string;
    mode?: CommandMode;
    requiredPriority?: number;
    listed?: boolean;
};

export type RawImportJson = {
    houseUuid?: string;
    include?: string[];
    functions?: RawFunctionImportable[];
    events?: RawEventImportable[];
    regions?: RawRegionImportable[];
    items?: RawItemImportable[];
    menus?: RawMenuImportable[];
    teams?: RawTeamImportable[];
    groups?: RawGroupImportable[];
    commands?: RawCommandImportable[];
    npcs?: RawNpcImportable[];
};

export type SchemaSpec =
    | StringSchemaSpec
    | NumberSchemaSpec
    | BooleanSchemaSpec
    | ArraySchemaSpec
    | ObjectSchemaSpec
    | RefSchemaSpec;

export type StringSchemaSpec = {
    kind: "string";
    pattern?: string;
    description?: string;
    enum?: readonly string[];
};
type NumberSchemaSpec = {
    kind: "number";
    integer?: boolean;
    minimum?: number;
    maximum?: number;
    description?: string;
};
type BooleanSchemaSpec = { kind: "boolean"; description?: string };
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

type DefinitionTypes = {
    importJsonPath: string;
    htslPath: string;
    snbtPath: string;
    functionImportable: RawFunctionImportable;
    functionIcon: RawFunctionIcon;
    eventImportable: RawEventImportable;
    pos: RawPos;
    bounds: RawBounds;
    regionImportable: RawRegionImportable;
    itemImportable: RawItemImportable;
    menuImportable: RawMenuImportable;
    menuSlot: RawMenuSlot;
    npcSkin: RawNpcSkin;
    npcEquipment: RawNpcEquipment;
    npcImportable: RawNpcImportable;
    color: Color;
    teamImportable: RawTeamImportable;
    permissions: RawPermissions;
    chatSpeed: ChatSpeed;
    defaultGameMode: DefaultGameMode;
    groupImportable: RawGroupImportable;
    commandMode: CommandMode;
    commandImportable: RawCommandImportable;
};

export type ImportJsonSchemaDefinitionName = keyof DefinitionTypes;
export type RefSchemaSpec = {
    kind: "ref";
    ref: ImportJsonSchemaDefinitionName;
    description?: string;
};
type SchemaPropertySpec = SchemaSpec & { required: boolean };

type SchemaProperties<T extends object> = {
    [K in keyof T]-?: SchemaPropertySpec & {
        required: undefined extends T[K] ? false : true;
    };
};

const permissionProperties = Object.fromEntries(
    PERMISSIONS.map((permission) => [permission, optional(boolean())])
) as SchemaProperties<RawPermissions>;

export const IMPORT_JSON_SCHEMA = object<RawImportJson>({
    houseUuid: optional(
        string({
            pattern:
                "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
            description:
                "Housing UUID binding. Only the entry import.json's binding is used.",
        })
    ),
    include: optional(array(ref("importJsonPath"))),
    functions: optional(array(ref("functionImportable"))),
    events: optional(array(ref("eventImportable"))),
    regions: optional(array(ref("regionImportable"))),
    items: optional(array(ref("itemImportable"))),
    menus: optional(array(ref("menuImportable"))),
    teams: optional(array(ref("teamImportable"))),
    groups: optional(array(ref("groupImportable"))),
    commands: optional(array(ref("commandImportable"))),
    npcs: optional(array(ref("npcImportable"))),
});

export const IMPORT_JSON_SCHEMA_DEFINITIONS: {
    [K in ImportJsonSchemaDefinitionName]: SchemaSpec;
} = {
    importJsonPath: string({ pattern: "\\.?[iI][mM][pP][oO][rR][tT]\\.json$" }),
    htslPath: string({ pattern: "\\.htsl$" }),
    snbtPath: string({ pattern: "\\.snbt$" }),
    functionImportable: object<RawFunctionImportable>({
        name: required(string()),
        actions: optional(ref("htslPath")),
        repeatTicks: optional(number({ minimum: 4, maximum: 18000 })),
        icon: optional(ref("functionIcon")),
    }),
    functionIcon: object<RawFunctionIcon>({
        item: required(string()),
        count: optional(integer({ minimum: 1, maximum: 64 })),
        enchanted: optional(boolean()),
    }),
    eventImportable: object<RawEventImportable>({
        event: required(string({ enum: EVENTS })),
        actions: required(ref("htslPath")),
    }),
    pos: object<RawPos>({
        x: required(number()),
        y: required(number()),
        z: required(number()),
    }),
    bounds: object<RawBounds>({
        from: required(ref("pos")),
        to: required(ref("pos")),
    }),
    regionImportable: object<RawRegionImportable>({
        name: required(string()),
        bounds: optional(ref("bounds")),
        onEnterActions: optional(ref("htslPath")),
        onExitActions: optional(ref("htslPath")),
    }),
    itemImportable: object<RawItemImportable>({
        name: required(string()),
        nbt: required(ref("snbtPath")),
        leftClickActions: optional(ref("htslPath")),
        rightClickActions: optional(ref("htslPath")),
    }),
    menuImportable: object<RawMenuImportable>({
        name: required(string()),
        size: optional(integer({ minimum: 1, maximum: 6 })),
        slots: required(array(ref("menuSlot"))),
    }),
    menuSlot: object<RawMenuSlot>({
        slot: required(integer({ minimum: 0, maximum: 53 })),
        nbt: required(ref("snbtPath")),
        actions: optional(ref("htslPath")),
    }),
    npcSkin: string({ enum: NPC_SKINS }),
    npcEquipment: object<RawNpcEquipment>({
        helmet: optional(ref("snbtPath")),
        chestplate: optional(ref("snbtPath")),
        leggings: optional(ref("snbtPath")),
        boots: optional(ref("snbtPath")),
        hand: optional(ref("snbtPath")),
    }),
    npcImportable: object<RawNpcImportable>({
        name: required(string()),
        pos: required(ref("pos")),
        leftClickActions: optional(ref("htslPath")),
        rightClickActions: optional(ref("htslPath")),
        leftClickRedirect: optional(boolean()),
        lookAtPlayers: optional(boolean()),
        hideNameTag: optional(boolean()),
        skin: optional(ref("npcSkin")),
        equipment: optional(ref("npcEquipment")),
    }),
    color: string({ enum: COLORS }),
    teamImportable: object<RawTeamImportable>({
        name: required(string()),
        tag: optional(string({ pattern: "^[A-Za-z0-9 ]*$" })),
        color: optional(ref("color")),
        friendlyFire: optional(boolean()),
    }),
    permissions: object<RawPermissions>(permissionProperties),
    chatSpeed: string({ enum: CHAT_SPEEDS }),
    defaultGameMode: string({ enum: DEFAULT_GAME_MODES }),
    groupImportable: object<RawGroupImportable>({
        name: required(string()),
        tag: optional(string({ pattern: "^[A-Za-z0-9 ]*$" })),
        tagShownInChat: optional(boolean()),
        color: optional(ref("color")),
        priority: optional(integer({ minimum: 0, maximum: 20 })),
        permissions: optional(ref("permissions")),
        chatSpeed: optional(ref("chatSpeed")),
        defaultGameMode: optional(ref("defaultGameMode")),
    }),
    commandMode: string({ enum: COMMAND_MODES }),
    commandImportable: object<RawCommandImportable>({
        name: required(string()),
        actions: optional(ref("htslPath")),
        mode: optional(ref("commandMode")),
        requiredPriority: optional(integer({ minimum: 0, maximum: 20 })),
        listed: optional(boolean()),
    }),
};

function string(options: Omit<StringSchemaSpec, "kind"> = {}): StringSchemaSpec {
    return { kind: "string", ...options };
}
function number(
    options: Omit<NumberSchemaSpec, "kind" | "integer"> = {}
): NumberSchemaSpec {
    return { kind: "number", ...options };
}
function integer(
    options: Omit<NumberSchemaSpec, "kind" | "integer"> = {}
): NumberSchemaSpec {
    return { kind: "number", integer: true, ...options };
}
function boolean(options: Omit<BooleanSchemaSpec, "kind"> = {}): BooleanSchemaSpec {
    return { kind: "boolean", ...options };
}
function array(
    items: SchemaSpec,
    options: Omit<ArraySchemaSpec, "kind" | "items"> = {}
): ArraySchemaSpec {
    return { kind: "array", items, ...options };
}
function object<T extends object>(
    properties: SchemaProperties<T>,
    options: Omit<ObjectSchemaSpec, "kind" | "properties"> = {}
): ObjectSchemaSpec {
    return { kind: "object", properties, ...options };
}
function ref(
    name: ImportJsonSchemaDefinitionName,
    options: Omit<RefSchemaSpec, "kind" | "ref"> = {}
): RefSchemaSpec {
    return { kind: "ref", ref: name, ...options };
}
function required<T extends SchemaSpec>(spec: T): T & { required: true } {
    return { ...spec, required: true };
}
function optional<T extends SchemaSpec>(spec: T): T & { required: false } {
    return { ...spec, required: false };
}
