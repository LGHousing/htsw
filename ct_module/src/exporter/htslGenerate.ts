import type {
    Action,
    Condition,
    Location,
    VarOperation,
    Comparison,
} from "htsw/types";

const OP_SYMBOLS: Record<VarOperation, string> = {
    Set: "=",
    Increment: "+=",
    Decrement: "-=",
    Multiply: "*=",
    Divide: "/=",
    "Shift Left": "<<=",
    "Shift Right": ">>=",
    "And Assign": "&=",
    "Or Assign": "|=",
    "Xor Assign": "^=",
    Unset: "Unset",
};

const CMP_SYMBOLS: Record<Comparison, string> = {
    Equal: "==",
    "Less Than": "<",
    "Less Than Or Equal": "<=",
    "Greater Than": ">",
    "Greater Than Or Equal": ">=",
};

function indent(level: number): string {
    return "    ".repeat(level);
}

function quoted(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    return JSON.stringify(value);
}

function bool(value: boolean | undefined): string | undefined {
    if (value === undefined) return undefined;
    return value ? "true" : "false";
}

function optionIdent(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    return value.replace(/ /g, "_");
}

function locationValue(location: Location | undefined): string | undefined {
    if (location === undefined) return undefined;
    if (location.type === "Custom Coordinates") {
        return `${optionIdent(location.type)} ${quoted(location.value)}`;
    }
    return optionIdent(location.type);
}

function joinParts(...parts: Array<string | number | undefined>): string {
    return parts.filter((it) => it !== undefined).join(" ");
}

function emitCondition(condition: Condition): string {
    const inversion = condition.inverted ? "!" : "";
    switch (condition.type) {
        case "REQUIRE_GROUP":
            return joinParts(`${inversion}hasGroup`, quoted(condition.group), bool(condition.includeHigherGroups));
        case "COMPARE_VAR": {
            const holderPrefix =
                condition.holder?.type === "global"
                    ? "globalvar"
                    : condition.holder?.type === "team"
                        ? `teamvar ${quoted(condition.holder.team)}`
                        : "var";
            return joinParts(
                `${inversion}${holderPrefix}`,
                quoted(condition.var),
                condition.op ? CMP_SYMBOLS[condition.op] : undefined,
                condition.amount,
                condition.fallback
            );
        }
        case "REQUIRE_PERMISSION":
            return joinParts(`${inversion}hasPermission`, optionIdent(condition.permission));
        case "IS_IN_REGION":
            return joinParts(`${inversion}inRegion`, quoted(condition.region));
        case "REQUIRE_ITEM":
            return joinParts(
                `${inversion}hasItem`,
                quoted(condition.item),
                optionIdent(condition.whatToCheck),
                optionIdent(condition.whereToCheck),
                optionIdent(condition.amount)
            );
        case "IS_DOING_PARKOUR":
            return `${inversion}doingParkour`;
        case "REQUIRE_POTION_EFFECT":
            return joinParts(`${inversion}hasPotion`, optionIdent(condition.effect));
        case "IS_SNEAKING":
            return `${inversion}isSneaking`;
        case "IS_FLYING":
            return `${inversion}isFlying`;
        case "COMPARE_HEALTH":
            return joinParts(`${inversion}health`, condition.op ? CMP_SYMBOLS[condition.op] : undefined, condition.amount);
        case "COMPARE_MAX_HEALTH":
            return joinParts(`${inversion}maxHealth`, condition.op ? CMP_SYMBOLS[condition.op] : undefined, condition.amount);
        case "COMPARE_HUNGER":
            return joinParts(`${inversion}hunger`, condition.op ? CMP_SYMBOLS[condition.op] : undefined, condition.amount);
        case "REQUIRE_GAMEMODE":
            return joinParts(`${inversion}gamemode`, optionIdent(condition.gamemode));
        case "COMPARE_PLACEHOLDER":
            return joinParts(
                `${inversion}placeholder`,
                condition.placeholder,
                condition.op ? CMP_SYMBOLS[condition.op] : undefined,
                condition.amount
            );
        case "REQUIRE_TEAM":
            return joinParts(`${inversion}hasTeam`, quoted(condition.team));
        case "COMPARE_DAMAGE":
            return joinParts(`${inversion}damageAmount`, condition.op ? CMP_SYMBOLS[condition.op] : undefined, condition.amount);
        default:
            return "";
    }
}

function emitBlock(actions: Action[], level: number): string[] {
    const lines: string[] = [`${indent(level)}{`];
    for (const action of actions) {
        lines.push(...emitAction(action, level + 1));
    }
    lines.push(`${indent(level)}}`);
    return lines;
}

function emitActionLine(action: Action): string {
    switch (action.type) {
        case "ACTION_BAR":
            return joinParts("actionBar", quoted(action.message));
        case "APPLY_INVENTORY_LAYOUT":
            return joinParts("applyLayout", quoted(action.layout));
        case "APPLY_POTION_EFFECT":
            return joinParts(
                "applyPotion",
                optionIdent(action.effect),
                action.duration,
                action.level,
                bool(action.override),
                bool(action.showIcon)
            );
        case "CANCEL_EVENT":
            return "cancelEvent";
        case "CHANGE_HEALTH":
            return joinParts("changeHealth", action.op ? OP_SYMBOLS[action.op] : undefined, action.amount);
        case "CHANGE_HUNGER":
            return joinParts("hungerLevel", action.op ? OP_SYMBOLS[action.op] : undefined, action.amount);
        case "CHANGE_MAX_HEALTH":
            return joinParts("maxHealth", action.op ? OP_SYMBOLS[action.op] : undefined, action.amount, bool(action.heal));
        case "CHANGE_VAR": {
            const prefix =
                action.holder.type === "global"
                    ? "globalvar"
                    : action.holder.type === "team"
                        ? `teamvar ${quoted(action.holder.team)}`
                        : "var";
            return joinParts(
                prefix,
                quoted(action.key),
                OP_SYMBOLS[action.op],
                action.op === "Unset" ? undefined : action.value,
                bool(action.unset)
            );
        }
        case "CLEAR_POTION_EFFECTS":
            return "clearEffects";
        case "DROP_ITEM":
            return joinParts(
                "dropItem",
                quoted(action.item),
                locationValue(action.location),
                bool(action.dropNaturally),
                bool(action.disableMerging),
                bool(action.prioritizePlayer),
                bool(action.inventoryFallback)
            );
        case "ENCHANT_HELD_ITEM":
            return joinParts("enchant", optionIdent(action.enchant), action.level);
        case "EXIT":
            return "exit";
        case "FAIL_PARKOUR":
            return joinParts("failParkour", quoted(action.message));
        case "FUNCTION":
            return joinParts("function", quoted(action.function), bool(action.global));
        case "GIVE_EXPERIENCE_LEVELS":
            return joinParts("xpLevel", action.amount);
        case "GIVE_ITEM":
            return joinParts(
                "giveItem",
                quoted(action.item),
                bool(action.allowMultiple),
                action.slot,
                bool(action.replaceExisting)
            );
        case "HEAL":
            return "fullHeal";
        case "KILL":
            return "kill";
        case "LAUNCH":
            return joinParts("launch", locationValue(action.location), action.strength);
        case "MESSAGE":
            return joinParts("chat", quoted(action.message));
        case "PAUSE":
            return joinParts("pause", action.ticks);
        case "PLAY_SOUND":
            return joinParts("sound", quoted(action.sound), action.volume, action.pitch, locationValue(action.location));
        case "REMOVE_ITEM":
            return joinParts("removeItem", quoted(action.item));
        case "RESET_INVENTORY":
            return "resetInventory";
        case "SEND_TO_LOBBY":
            return joinParts("lobby", optionIdent(action.lobby));
        case "SET_COMPASS_TARGET":
            return joinParts("compassTarget", locationValue(action.location));
        case "SET_GAMEMODE":
            return joinParts("gamemode", optionIdent(action.gamemode));
        case "SET_GROUP":
            return joinParts("changePlayerGroup", quoted(action.group), bool(action.demotionProtection));
        case "SET_MENU":
            return joinParts("displayMenu", quoted(action.menu));
        case "SET_TEAM":
            return joinParts("setTeam", quoted(action.team));
        case "SET_VELOCITY":
            return joinParts("changeVelocity", action.x, action.y, action.z);
        case "TELEPORT":
            return joinParts("tp", locationValue(action.location));
        case "TITLE":
            return joinParts(
                "title",
                quoted(action.title),
                quoted(action.subtitle),
                action.fadein,
                action.stay,
                action.fadeout
            );
        case "CONDITIONAL":
        case "RANDOM":
            return "";
        default:
            return "";
    }
}

function emitAction(action: Action, level: number): string[] {
    const lines: string[] = [];
    if (action.note) {
        lines.push(`${indent(level)}/// ${action.note}`);
    }

    if (action.type === "CONDITIONAL") {
        const conditionParts = (action.conditions ?? []).map((condition: Condition) =>
            emitCondition(condition)
        );
        const modePrefix = action.matchAny ? "or " : "";
        lines.push(`${indent(level)}if ${modePrefix}(${conditionParts.join(", ")}) {`);
        for (const child of action.ifActions) {
            lines.push(...emitAction(child, level + 1));
        }
        lines.push(`${indent(level)}}`);
        if (action.elseActions && action.elseActions.length > 0) {
            lines.push(`${indent(level)}else {`);
            for (const child of action.elseActions) {
                lines.push(...emitAction(child, level + 1));
            }
            lines.push(`${indent(level)}}`);
        }
        return lines;
    }

    if (action.type === "RANDOM") {
        lines.push(`${indent(level)}random {`);
        for (const child of action.actions) {
            lines.push(...emitAction(child, level + 1));
        }
        lines.push(`${indent(level)}}`);
        return lines;
    }

    lines.push(`${indent(level)}${emitActionLine(action)}`);
    return lines;
}

export function generateFunctionHtsl(actions: Action[]): string {
    const lines: string[] = [];
    for (const action of actions) {
        lines.push(...emitAction(action, 0));
    }
    if (lines.length === 0) return "";
    return `${lines.join("\n")}\n`;
}
