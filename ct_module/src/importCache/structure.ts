import type { Action, Condition, Importable } from "htsw/types";

type Check = (value: unknown) => boolean;
// Exhaustive tags and fields: changes to the AST must update these checks too.
// Source paths are parser metadata, not trusted Housing content.
type Shapes<T extends { type: string }> = {
    [Kind in T["type"]]: {
        [
            Field in Exclude<
                keyof Extract<T, { type: Kind }>,
                "type" | "note" | "inverted" | "sourcePath" | `${string}Path`
            >
        ]-?: Check;
    };
};

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

const text = (value: unknown): value is string => typeof value === "string";
const number: Check = (value) => typeof value === "number" && Number.isFinite(value);
const boolean: Check = (value) => typeof value === "boolean";
const optional =
    (check: Check): Check =>
    (value) =>
        value === undefined || check(value);
const optionalText = optional(text),
    optionalNumber = optional(number),
    optionalBoolean = optional(boolean);

function fields(value: Record<string, unknown>, checks: Record<string, Check>): boolean {
    for (const field in checks) if (!checks[field](value[field])) return false;
    return true;
}

function shape(checks: Record<string, Check>): Check {
    return (value) => isRecord(value) && fields(value, checks);
}

function tagged(
    value: unknown,
    shapes: Record<string, Record<string, Check>>
): value is Record<string, unknown> {
    return (
        isRecord(value) &&
        typeof value.type === "string" &&
        Object.prototype.hasOwnProperty.call(shapes, value.type) &&
        fields(value, shapes[value.type])
    );
}

const pos = shape({ x: number, y: number, z: number });
const coordinate: Check = (value) =>
    isRecord(value) &&
    (value.kind === "absolute" || value.kind === "relative" || value.kind === "local") &&
    text(value.value);
const coordinates = shape({
    x: coordinate,
    y: coordinate,
    z: coordinate,
    pitch: optionalText,
    yaw: optionalText,
});
const optionalCoordinates = optional(coordinates);
const location: Check = (value) =>
    isRecord(value) &&
    (value.type === "House Spawn Location" ||
        value.type === "Invokers Location" ||
        value.type === "Current Location" ||
        (value.type === "Custom Coordinates" &&
            text(value.value) &&
            optionalCoordinates(value.coordinates)));
const holder: Check = (value) =>
    isRecord(value) &&
    (value.type === "Player" ||
        value.type === "Global" ||
        (value.type === "Team" && optionalText(value.team)));
const slot: Check = (value) => text(value) || number(value);

// Only structure and primitive types: no comparison keys, normalization or hashes.
function actions(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    for (const action of value) {
        if (!tagged(action, actionShapes) || !optionalText(action.note)) return false;
    }
    return true;
}

function conditions(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    for (const condition of value) {
        if (
            !tagged(condition, conditionShapes) ||
            !optionalText(condition.note) ||
            !optionalBoolean(condition.inverted)
        )
            return false;
    }
    return true;
}

const actionShapes: Shapes<Action> = {
    CONDITIONAL: {
        matchAny: boolean,
        conditions,
        ifActions: actions,
        elseActions: actions,
    },
    SET_GROUP: { group: text, demotionProtection: optionalBoolean },
    KILL: {},
    HEAL: {},
    TITLE: {
        title: text,
        subtitle: optionalText,
        fadein: optionalNumber,
        stay: optionalNumber,
        fadeout: optionalNumber,
    },
    ACTION_BAR: { message: text },
    RESET_INVENTORY: {},
    CHANGE_MAX_HEALTH: { op: text, amount: text, heal: optionalBoolean },
    GIVE_ITEM: {
        itemName: text,
        allowMultiple: optionalBoolean,
        slot: optional(slot),
        replaceExisting: optionalBoolean,
    },
    REMOVE_ITEM: { itemName: optionalText },
    MESSAGE: { message: text },
    APPLY_POTION_EFFECT: {
        effect: text,
        duration: number,
        level: optionalNumber,
        override: optionalBoolean,
        showIcon: optionalBoolean,
    },
    CLEAR_POTION_EFFECTS: {},
    GIVE_EXPERIENCE_LEVELS: { amount: text },
    SEND_TO_LOBBY: { lobby: optionalText },
    CHANGE_VAR: {
        holder,
        key: text,
        op: text,
        value: optionalText,
        unset: optionalBoolean,
    },
    TELEPORT: { location, preventTeleportInsideBlocks: optionalBoolean },
    FAIL_PARKOUR: { message: optionalText },
    PARKOUR_CHECKPOINT: {},
    PLAY_SOUND: {
        sound: text,
        volume: optionalNumber,
        pitch: optionalNumber,
        location: optional(location),
    },
    SET_COMPASS_TARGET: { location },
    SET_GAMEMODE: { gamemode: text },
    CHANGE_HEALTH: { op: text, amount: text },
    CHANGE_HUNGER: { op: text, amount: text },
    RANDOM: { actions },
    FUNCTION: { function: text, global: optionalBoolean },
    APPLY_INVENTORY_LAYOUT: { layout: text },
    ENCHANT_HELD_ITEM: { enchant: text, level: number },
    PAUSE: { ticks: number },
    SET_TEAM: { team: text },
    SET_MENU: { menu: text },
    CLOSE_MENU: {},
    SET_PLAYER_WEATHER: { weather: text },
    SET_PLAYER_TIME: { time: number },
    TOGGLE_NAMETAG_DISPLAY: { displayNametag: boolean },
    USE_HELD_ITEM: {},
    DROP_ITEM: {
        itemName: text,
        location,
        dropNaturally: optionalBoolean,
        disableMerging: optionalBoolean,
        despawnDurationTicks: optionalText,
        pickupDelayTicks: optionalText,
        prioritizePlayer: optionalBoolean,
        inventoryFallback: optionalBoolean,
    },
    SET_VELOCITY: { x: text, y: text, z: text },
    LAUNCH: { location, strength: text },
    EXIT: {},
    CANCEL_EVENT: {},
};

const conditionShapes: Shapes<Condition> = {
    REQUIRE_GROUP: { group: optionalText, includeHigherGroups: optionalBoolean },
    COMPARE_VAR: {
        holder: optional(holder),
        var: optionalText,
        op: optionalText,
        amount: optionalText,
        fallback: optionalText,
    },
    REQUIRE_PERMISSION: { permission: optionalText },
    IS_IN_REGION: { region: optionalText },
    REQUIRE_ITEM: {
        itemName: optionalText,
        whatToCheck: optionalText,
        whereToCheck: optionalText,
        amount: optionalText,
    },
    IS_DOING_PARKOUR: {},
    REQUIRE_POTION_EFFECT: { effect: optionalText },
    IS_SNEAKING: {},
    IS_FLYING: {},
    COMPARE_HEALTH: { op: optionalText, amount: optionalText },
    COMPARE_MAX_HEALTH: { op: optionalText, amount: optionalText },
    COMPARE_HUNGER: { op: optionalText, amount: optionalText },
    REQUIRE_GAMEMODE: { gamemode: optionalText },
    COMPARE_PLACEHOLDER: {
        placeholder: optionalText,
        op: optionalText,
        amount: optionalText,
    },
    REQUIRE_TEAM: { team: optionalText },
    DAMAGE_CAUSE: { cause: optionalText },
    PVP_ENABLED: {},
    FISHING_ENVIRONMENT: { environment: optionalText },
    PORTAL_TYPE: { portalType: optionalText },
    BLOCK_TYPE: { itemName: optionalText },
    IS_ITEM: { itemName: optionalText },
    COMPARE_DAMAGE: { op: optionalText, amount: optionalText },
};

const optionalActions = optional(actions);
const menuSlot = shape({ slot: number, nbt: isRecord, actions: optionalActions });
const menuSlots: Check = (value) => Array.isArray(value) && value.every(menuSlot);
const permissions: Check = (value) =>
    isRecord(value) && Object.keys(value).every((key) => boolean(value[key]));
const importableShapes: Shapes<Importable> = {
    FUNCTION: {
        name: text,
        actions: optionalActions,
        description: optionalText,
        repeatTicks: optionalNumber,
        icon: optional(
            shape({ item: text, count: optionalNumber, enchanted: optionalBoolean })
        ),
    },
    EVENT: { event: text, actions },
    COMMAND: {
        name: text,
        actions: optionalActions,
        mode: optionalText,
        requiredPriority: optionalNumber,
        listed: optionalBoolean,
    },
    REGION: {
        name: text,
        bounds: shape({ from: pos, to: pos }),
        onEnterActions: optionalActions,
        onExitActions: optionalActions,
    },
    NPC: {
        name: text,
        pos,
        leftClickActions: optionalActions,
        rightClickActions: optionalActions,
        leftClickRedirect: optionalBoolean,
        lookAtPlayers: optionalBoolean,
        hideNameTag: optionalBoolean,
        skin: optionalText,
        equipment: optional(
            shape({
                helmet: optionalText,
                chestplate: optionalText,
                leggings: optionalText,
                boots: optionalText,
                hand: optionalText,
            })
        ),
    },
    ITEM: {
        name: text,
        nbt: isRecord,
        leftClickActions: optionalActions,
        rightClickActions: optionalActions,
    },
    MENU: { name: text, size: optionalNumber, slots: menuSlots },
    TEAM: {
        name: text,
        tag: optionalText,
        color: optionalText,
        friendlyFire: optionalBoolean,
    },
    GROUP: {
        name: text,
        tag: optionalText,
        tagShownInChat: optionalBoolean,
        color: optionalText,
        priority: optionalNumber,
        permissions: optional(permissions),
        chatSpeed: optionalText,
        defaultGameMode: optionalText,
    },
};

export function validStoredImportable(value: unknown): value is Importable {
    return (
        tagged(value, importableShapes) &&
        (value.type === "EVENT"
            ? text(value.event) && value.event.length > 0
            : text(value.name) && value.name.length > 0)
    );
}
