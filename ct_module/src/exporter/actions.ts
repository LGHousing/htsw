import type { Action } from "htsw/types";
import {
    ENCHANTMENTS,
    GAMEMODES,
    INVENTORY_SLOTS,
    LOBBIES,
    POTION_EFFECTS,
} from "htsw/types";
import TaskContext from "../tasks/context";
import { removedFormatting } from "../helpers";
import { clickGoBack, waitForMenuToLoad } from "../importer/helpers";
import { readConditionList } from "./conditions";
import { readNormalizedFieldValue } from "./helpers";
import {
    mapActionDisplayName,
    parseBooleanCurrentValue,
    parseLocationCurrentValue,
    parseNumberCurrentValue,
    parseOperationCurrentValue,
    parseSoundCurrentValue,
    parseVarOperationCurrentValue,
} from "./scrapeParsers";

type ActionType = Action["type"];
type ActionOfType<T extends ActionType> = Extract<Action, { type: T }>;

type ActionSlotDescriptor = {
    slotId: number;
    displayName: string;
    type: ActionType;
};

type ActionFactoryMap = {
    [K in ActionType]: () => ActionOfType<K>;
};

export type ActionReader<T extends ActionType> = (
    ctx: TaskContext,
    action: ActionOfType<T>
) => Promise<void>;

type ActionReaderMap = {
    [K in ActionType]: ActionReader<K>;
};

const ACTION_LIST_CONTROL_SLOT_NAMES = new Set([
    "Add Action",
    "Add Condition",
    "Go Back",
    "Close",
    "Search",
    "Left-click for next page!",
    "Right-click for previous page!",
]);

function parseOptionValue<T extends string>(
    value: string | undefined,
    options: readonly T[]
): T | undefined {
    const normalized = (value ?? "").trim().toLowerCase();
    if (!normalized) return undefined;
    for (const option of options) {
        if (option.toLowerCase() === normalized) return option;
    }
    return undefined;
}

function parseItemSlotValue(value: string | undefined): number | string | undefined {
    const numeric = parseNumberCurrentValue(value);
    if (numeric !== undefined) return numeric;
    return parseOptionValue(value, INVENTORY_SLOTS);
}

export const ACTION_DEFAULTS: ActionFactoryMap = {
    ACTION_BAR: () => ({ type: "ACTION_BAR", message: "" }),
    APPLY_INVENTORY_LAYOUT: () => ({ type: "APPLY_INVENTORY_LAYOUT", layout: "" }),
    APPLY_POTION_EFFECT: () => ({
        type: "APPLY_POTION_EFFECT",
        effect: POTION_EFFECTS[0],
        duration: 1,
        level: 1,
    }),
    CANCEL_EVENT: () => ({ type: "CANCEL_EVENT" }),
    CHANGE_HEALTH: () => ({ type: "CHANGE_HEALTH", op: "Set", amount: "0" }),
    CHANGE_HUNGER: () => ({ type: "CHANGE_HUNGER", op: "Set", amount: "0" }),
    CHANGE_MAX_HEALTH: () => ({ type: "CHANGE_MAX_HEALTH", op: "Set", amount: "0" }),
    CHANGE_VAR: () => ({
        type: "CHANGE_VAR",
        holder: { type: "player" },
        key: "",
        op: "Set",
        value: "0",
    }),
    CLEAR_POTION_EFFECTS: () => ({ type: "CLEAR_POTION_EFFECTS" }),
    CONDITIONAL: () => ({
        type: "CONDITIONAL",
        matchAny: false,
        conditions: [],
        ifActions: [],
    }),
    DROP_ITEM: () => ({ type: "DROP_ITEM", item: "" }),
    ENCHANT_HELD_ITEM: () => ({
        type: "ENCHANT_HELD_ITEM",
        enchant: ENCHANTMENTS[0],
        level: 1,
    }),
    EXIT: () => ({ type: "EXIT" }),
    FAIL_PARKOUR: () => ({ type: "FAIL_PARKOUR" }),
    FUNCTION: () => ({ type: "FUNCTION", function: "" }),
    GIVE_EXPERIENCE_LEVELS: () => ({ type: "GIVE_EXPERIENCE_LEVELS", amount: "0" }),
    GIVE_ITEM: () => ({ type: "GIVE_ITEM" }),
    HEAL: () => ({ type: "HEAL" }),
    KILL: () => ({ type: "KILL" }),
    LAUNCH: () => ({
        type: "LAUNCH",
        location: { type: "Invokers Location" },
        strength: 1,
    }),
    MESSAGE: () => ({ type: "MESSAGE", message: "" }),
    PAUSE: () => ({ type: "PAUSE", ticks: 1 }),
    PLAY_SOUND: () => ({ type: "PLAY_SOUND", sound: "note.bass" }),
    RANDOM: () => ({ type: "RANDOM", actions: [] }),
    REMOVE_ITEM: () => ({ type: "REMOVE_ITEM" }),
    RESET_INVENTORY: () => ({ type: "RESET_INVENTORY" }),
    SEND_TO_LOBBY: () => ({ type: "SEND_TO_LOBBY" }),
    SET_COMPASS_TARGET: () => ({
        type: "SET_COMPASS_TARGET",
        location: { type: "Invokers Location" },
    }),
    SET_GAMEMODE: () => ({ type: "SET_GAMEMODE", gamemode: GAMEMODES[0] }),
    SET_GROUP: () => ({ type: "SET_GROUP", group: "" }),
    SET_MENU: () => ({ type: "SET_MENU", menu: "" }),
    SET_TEAM: () => ({ type: "SET_TEAM", team: "" }),
    SET_VELOCITY: () => ({ type: "SET_VELOCITY", x: "0", y: "0", z: "0" }),
    TELEPORT: () => ({
        type: "TELEPORT",
        location: { type: "Invokers Location" },
    }),
    TITLE: () => ({ type: "TITLE", title: "" }),
};

async function readNestedActions(
    ctx: TaskContext,
    slotNames: string[]
): Promise<Action[] | undefined> {
    for (const slotName of slotNames) {
        const slot = ctx.tryGetItemSlot(slotName);
        if (!slot) continue;
        slot.click();
        await waitForMenuToLoad(ctx);
        const actions = await readActionList(ctx);
        clickGoBack(ctx);
        await waitForMenuToLoad(ctx);
        return actions;
    }
    return undefined;
}

export const ACTION_READERS: ActionReaderMap = {
    ACTION_BAR: async (ctx, action) => {
        action.message = readNormalizedFieldValue(ctx, ["Message"]) ?? action.message;
    },
    APPLY_INVENTORY_LAYOUT: async (ctx, action) => {
        action.layout = readNormalizedFieldValue(ctx, ["Layout"]) ?? action.layout;
    },
    APPLY_POTION_EFFECT: async (ctx, action) => {
        const effect = parseOptionValue(
            readNormalizedFieldValue(ctx, ["Effect"]),
            POTION_EFFECTS
        );
        const duration = parseNumberCurrentValue(
            readNormalizedFieldValue(ctx, ["Duration"])
        );
        const level = parseNumberCurrentValue(readNormalizedFieldValue(ctx, ["Level"]));
        const override = parseBooleanCurrentValue(
            readNormalizedFieldValue(ctx, ["Override", "Override Existing Effect"])
        );
        const showIcon = parseBooleanCurrentValue(
            readNormalizedFieldValue(ctx, ["Show Icon"])
        );
        if (effect) action.effect = effect;
        if (duration !== undefined) action.duration = duration;
        if (level !== undefined) action.level = level;
        if (override !== undefined) action.override = override;
        if (showIcon !== undefined) action.showIcon = showIcon;
    },
    CANCEL_EVENT: async () => { },
    CHANGE_HEALTH: async (ctx, action) => {
        const op = parseOperationCurrentValue(
            readNormalizedFieldValue(ctx, ["Operation", "Operator"])
        );
        const amount = readNormalizedFieldValue(ctx, ["Amount", "Value"]);
        if (op) action.op = op;
        if (amount !== undefined) action.amount = amount;
    },
    CHANGE_HUNGER: async (ctx, action) => {
        const op = parseOperationCurrentValue(
            readNormalizedFieldValue(ctx, ["Operation", "Operator"])
        );
        const amount = readNormalizedFieldValue(ctx, ["Amount", "Value"]);
        if (op) action.op = op;
        if (amount !== undefined) action.amount = amount;
    },
    CHANGE_MAX_HEALTH: async (ctx, action) => {
        const op = parseOperationCurrentValue(
            readNormalizedFieldValue(ctx, ["Operation", "Operator"])
        );
        const amount = readNormalizedFieldValue(ctx, ["Amount", "Value"]);
        const heal = parseBooleanCurrentValue(readNormalizedFieldValue(ctx, ["Heal"]));
        if (op) action.op = op;
        if (amount !== undefined) action.amount = amount;
        if (heal !== undefined) action.heal = heal;
    },
    CHANGE_VAR: async (ctx, action) => {
        const holderValue = (
            readNormalizedFieldValue(ctx, ["Variable Scope", "Scope"]) ?? ""
        ).toLowerCase();
        if (holderValue.includes("global")) {
            action.holder = { type: "global" };
        } else if (holderValue.includes("team")) {
            action.holder = {
                type: "team",
                team: readNormalizedFieldValue(ctx, ["Team"]),
            };
        } else {
            action.holder = { type: "player" };
        }

        const key = readNormalizedFieldValue(ctx, ["Variable", "Key"]);
        const op = parseVarOperationCurrentValue(
            readNormalizedFieldValue(ctx, ["Operation", "Operator"])
        );
        const value = readNormalizedFieldValue(ctx, ["Value"]);
        const unset = parseBooleanCurrentValue(
            readNormalizedFieldValue(ctx, ["Unset if Null", "Unset"])
        );

        if (key !== undefined) action.key = key;
        if (op) action.op = op;
        if (value !== undefined) action.value = value;
        if (unset !== undefined) action.unset = unset;
    },
    CLEAR_POTION_EFFECTS: async () => { },
    CONDITIONAL: async (ctx, action) => {
        const matchAny = parseBooleanCurrentValue(
            readNormalizedFieldValue(ctx, ["Match Any Condition"])
        );
        if (matchAny !== undefined) action.matchAny = matchAny;

        action.conditions = await readConditionList(ctx);

        const ifActions = await readNestedActions(ctx, ["If Actions"]);
        if (ifActions) action.ifActions = ifActions;

        const elseActions = await readNestedActions(ctx, ["Else Actions"]);
        if (elseActions && elseActions.length > 0) {
            action.elseActions = elseActions;
        }
    },
    DROP_ITEM: async (ctx, action) => {
        const item = readNormalizedFieldValue(ctx, ["Item"]);
        const location = parseLocationCurrentValue(
            readNormalizedFieldValue(ctx, ["Location"])
        );
        const dropNaturally = parseBooleanCurrentValue(
            readNormalizedFieldValue(ctx, ["Drop Naturally"])
        );
        const disableMerging = parseBooleanCurrentValue(
            readNormalizedFieldValue(ctx, ["Disable Merging"])
        );
        const prioritizePlayer = parseBooleanCurrentValue(
            readNormalizedFieldValue(ctx, ["Prioritize Player"])
        );
        const inventoryFallback = parseBooleanCurrentValue(
            readNormalizedFieldValue(ctx, ["Inventory Fallback"])
        );

        if (item !== undefined) action.item = item;
        if (location) action.location = location;
        if (dropNaturally !== undefined) action.dropNaturally = dropNaturally;
        if (disableMerging !== undefined) action.disableMerging = disableMerging;
        if (prioritizePlayer !== undefined) action.prioritizePlayer = prioritizePlayer;
        if (inventoryFallback !== undefined) action.inventoryFallback = inventoryFallback;
    },
    ENCHANT_HELD_ITEM: async (ctx, action) => {
        const enchant = parseOptionValue(
            readNormalizedFieldValue(ctx, ["Enchantment"]),
            ENCHANTMENTS
        );
        const level = parseNumberCurrentValue(readNormalizedFieldValue(ctx, ["Level"]));
        if (enchant) action.enchant = enchant;
        if (level !== undefined) action.level = level;
    },
    EXIT: async () => { },
    FAIL_PARKOUR: async (ctx, action) => {
        action.message = readNormalizedFieldValue(ctx, ["Message"]);
    },
    FUNCTION: async (ctx, action) => {
        action.function =
            readNormalizedFieldValue(ctx, ["Function", "Function Name"]) ?? action.function;
        action.global =
            parseBooleanCurrentValue(
                readNormalizedFieldValue(ctx, ["Global", "Trigger Globally"])
            ) ?? action.global;
    },
    GIVE_EXPERIENCE_LEVELS: async (ctx, action) => {
        action.amount = readNormalizedFieldValue(ctx, ["Amount"]) ?? action.amount;
    },
    GIVE_ITEM: async (ctx, action) => {
        action.item = readNormalizedFieldValue(ctx, ["Item"]) ?? action.item;
        const allowMultiple = parseBooleanCurrentValue(
            readNormalizedFieldValue(ctx, ["Allow Multiple"])
        );
        const slot = parseItemSlotValue(readNormalizedFieldValue(ctx, ["Slot"]));
        const replaceExisting = parseBooleanCurrentValue(
            readNormalizedFieldValue(ctx, ["Replace Existing"])
        );
        if (allowMultiple !== undefined) action.allowMultiple = allowMultiple;
        if (slot !== undefined) {
            action.slot = slot as ActionOfType<"GIVE_ITEM">["slot"];
        }
        if (replaceExisting !== undefined) action.replaceExisting = replaceExisting;
    },
    HEAL: async () => { },
    KILL: async () => { },
    LAUNCH: async (ctx, action) => {
        const location = parseLocationCurrentValue(
            readNormalizedFieldValue(ctx, ["Location"])
        );
        const strength = parseNumberCurrentValue(
            readNormalizedFieldValue(ctx, ["Strength"])
        );
        if (location) action.location = location;
        if (strength !== undefined) action.strength = strength;
    },
    MESSAGE: async (ctx, action) => {
        action.message = readNormalizedFieldValue(ctx, ["Message"]) ?? action.message;
    },
    PAUSE: async (ctx, action) => {
        const ticks = parseNumberCurrentValue(
            readNormalizedFieldValue(ctx, ["Ticks", "Delay"])
        );
        if (ticks !== undefined) action.ticks = ticks;
    },
    PLAY_SOUND: async (ctx, action) => {
        const sound = parseSoundCurrentValue(readNormalizedFieldValue(ctx, ["Sound"]));
        const volume = parseNumberCurrentValue(
            readNormalizedFieldValue(ctx, ["Volume"])
        );
        const pitch = parseNumberCurrentValue(readNormalizedFieldValue(ctx, ["Pitch"]));
        const location = parseLocationCurrentValue(
            readNormalizedFieldValue(ctx, ["Location"])
        );
        if (sound) action.sound = sound;
        if (volume !== undefined) action.volume = volume;
        if (pitch !== undefined) action.pitch = pitch;
        if (location) action.location = location;
    },
    RANDOM: async (ctx, action) => {
        const nested = await readNestedActions(ctx, ["Actions", "Random Actions"]);
        action.actions = nested ?? [];
    },
    REMOVE_ITEM: async (ctx, action) => {
        action.item = readNormalizedFieldValue(ctx, ["Item"]);
    },
    RESET_INVENTORY: async () => { },
    SEND_TO_LOBBY: async (ctx, action) => {
        const lobby = parseOptionValue(
            readNormalizedFieldValue(ctx, ["Lobby"]),
            LOBBIES
        );
        if (lobby) action.lobby = lobby;
    },
    SET_COMPASS_TARGET: async (ctx, action) => {
        action.location =
            parseLocationCurrentValue(readNormalizedFieldValue(ctx, ["Location"])) ??
            action.location;
    },
    SET_GAMEMODE: async (ctx, action) => {
        const gamemode = parseOptionValue(
            readNormalizedFieldValue(ctx, ["Gamemode"]),
            GAMEMODES
        );
        if (gamemode) action.gamemode = gamemode;
    },
    SET_GROUP: async (ctx, action) => {
        action.group = readNormalizedFieldValue(ctx, ["Group"]) ?? action.group;
        action.demotionProtection =
            parseBooleanCurrentValue(
                readNormalizedFieldValue(ctx, ["Demotion Protection"])
            ) ?? action.demotionProtection;
    },
    SET_MENU: async (ctx, action) => {
        action.menu = readNormalizedFieldValue(ctx, ["Menu"]) ?? action.menu;
    },
    SET_TEAM: async (ctx, action) => {
        action.team = readNormalizedFieldValue(ctx, ["Team"]) ?? action.team;
    },
    SET_VELOCITY: async (ctx, action) => {
        const x = readNormalizedFieldValue(ctx, ["X"]);
        const y = readNormalizedFieldValue(ctx, ["Y"]);
        const z = readNormalizedFieldValue(ctx, ["Z"]);
        if (x !== undefined) action.x = x;
        if (y !== undefined) action.y = y;
        if (z !== undefined) action.z = z;
    },
    TELEPORT: async (ctx, action) => {
        action.location =
            parseLocationCurrentValue(readNormalizedFieldValue(ctx, ["Location"])) ??
            action.location;
    },
    TITLE: async (ctx, action) => {
        action.title = readNormalizedFieldValue(ctx, ["Title"]) ?? action.title;
        action.subtitle = readNormalizedFieldValue(ctx, ["Subtitle"]) ?? action.subtitle;
        action.fadein =
            parseNumberCurrentValue(readNormalizedFieldValue(ctx, ["Fade In", "Fadein"])) ??
            action.fadein;
        action.stay =
            parseNumberCurrentValue(readNormalizedFieldValue(ctx, ["Stay"])) ??
            action.stay;
        action.fadeout =
            parseNumberCurrentValue(readNormalizedFieldValue(ctx, ["Fade Out", "Fadeout"])) ??
            action.fadeout;
    },
};

function getActionSlotsOnCurrentPage(ctx: TaskContext): ActionSlotDescriptor[] {
    const slots = ctx.getAllItemSlots() ?? [];
    const actions: ActionSlotDescriptor[] = [];
    for (const slot of slots) {
        const displayName = removedFormatting(slot.getItem().getName()).trim();
        if (displayName.length === 0) continue;
        if (ACTION_LIST_CONTROL_SLOT_NAMES.has(displayName)) continue;

        const type = mapActionDisplayName(displayName);
        if (!type) continue;

        actions.push({
            slotId: slot.getSlotId(),
            displayName,
            type,
        });
    }
    actions.sort((a, b) => a.slotId - b.slotId);
    return actions;
}

function createDefaultAction(type: ActionType): Action {
    return ACTION_DEFAULTS[type]();
}

async function applyActionReader(
    ctx: TaskContext,
    type: ActionType,
    action: Action
): Promise<void> {
    const reader = ACTION_READERS[type] as (
        ctx: TaskContext,
        action: Action
    ) => Promise<void>;
    await reader(ctx, action);
}

export async function readActionFromOpenEditor(
    ctx: TaskContext,
    type: ActionType
): Promise<Action> {
    const action = createDefaultAction(type);
    const note = readNormalizedFieldValue(ctx, ["Note"]);
    if (note) {
        action.note = note;
    }

    await applyActionReader(ctx, type, action);
    return action;
}

export async function readActionList(ctx: TaskContext): Promise<Action[]> {
    const actions: Action[] = [];
    const seenPageSignatures = new Set<string>();

    while (true) {
        const currentPageActions = getActionSlotsOnCurrentPage(ctx);
        const signature = currentPageActions
            .map((it) => `${it.slotId}:${it.displayName}`)
            .join("|");

        if (seenPageSignatures.has(signature)) {
            break;
        }
        seenPageSignatures.add(signature);

        for (const item of currentPageActions) {
            const slot = ctx.tryGetItemSlot((slotCandidate) => {
                return slotCandidate.getSlotId() === item.slotId;
            });
            if (!slot) continue;

            slot.click();
            await waitForMenuToLoad(ctx);
            const action = await readActionFromOpenEditor(ctx, item.type);
            actions.push(action);
            clickGoBack(ctx);
            await waitForMenuToLoad(ctx);
        }

        const nextPageSlot = ctx.tryGetItemSlot("Left-click for next page!");
        if (!nextPageSlot) break;
        nextPageSlot.click();
        await waitForMenuToLoad(ctx);
    }

    return actions;
}
