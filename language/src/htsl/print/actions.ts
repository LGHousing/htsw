import type { Action } from "../../types";
import { OPERATION_SYMBOLS } from "../parse/helpers";
import {
    printBoolean,
    printInventorySlot,
    printLocation,
    printNumber,
    printOption,
    printSound,
    printValue,
} from "./arguments";
import { printCondition } from "./conditions";
import {
    indent,
    normalizeNoteForEmit,
    quoteName,
    quoteString,
    quoteStringOrPlaceholder,
} from "./helpers";
import type { PrintStyle } from "./style";

/**
 * Diagnostic emitted when the printer cannot fully round-trip an action.
 *
 * Currently produced by item-bearing actions (GIVE_ITEM, REMOVE_ITEM,
 * DROP_ITEM) since HTSL has no syntax for inline item NBT and we have to
 * fall back to a placeholder name.
 */
export type PrinterDiagnostic = {
    level: "warning";
    message: string;
};

export type PrintActionsContext = {
    style: PrintStyle;
    diagnostics: PrinterDiagnostic[];
};

const ITEM_PLACEHOLDER = "<item-not-supported>";

/**
 * Print an action list at a given indent depth. Each action emits one or more
 * full lines (with line endings); the last action is followed by a line
 * ending too, so the caller composing a block (`if () { ... }`) can simply
 * concatenate.
 */
export function printActionList(
    actions: readonly Action[],
    depth: number,
    ctx: PrintActionsContext,
): string {
    let out = "";
    for (const action of actions) {
        out += printActionAt(action, depth, ctx);
    }
    return out;
}

function printActionAt(
    action: Action,
    depth: number,
    ctx: PrintActionsContext,
): string {
    const pad = indent(depth, ctx.style);
    const eol = ctx.style.lineEnding;

    let out = "";

    if (action.note !== undefined && action.note.length > 0) {
        const note = normalizeNoteForEmit(action.note);
        if (note.length > 0) {
            out += `${pad}/// ${note}${eol}`;
        }
    }

    out += pad + printActionHead(action, depth, ctx) + eol;
    return out;
}

/**
 * Print the body of an action (without leading indent or trailing newline).
 * For block-bearing actions (CONDITIONAL, RANDOM) this returns multiple
 * lines including the `{ ... }` block; the trailing line has no newline so
 * `printActionAt` can append exactly one.
 */
function printActionHead(
    action: Action,
    depth: number,
    ctx: PrintActionsContext,
): string {
    switch (action.type) {
        case "ACTION_BAR":
            return `actionBar ${quoteStringOrPlaceholder(action.message)}`;
        case "APPLY_INVENTORY_LAYOUT":
            return `applyLayout ${quoteStringOrPlaceholder(action.layout)}`;
        case "APPLY_POTION_EFFECT": {
            const parts: string[] = [
                "applyPotion",
                printOption(action.effect),
                printNumber(action.duration),
            ];
            if (
                action.level !== undefined ||
                action.override !== undefined ||
                action.showIcon !== undefined
            ) {
                parts.push(printNumber(action.level ?? 1));
                parts.push(printBoolean(action.override ?? false));
                if (action.showIcon !== undefined) {
                    parts.push(printBoolean(action.showIcon));
                }
            }
            return parts.join(" ");
        }
        case "CANCEL_EVENT":
            return "cancelEvent";
        case "CHANGE_HEALTH":
            return `changeHealth ${printOption(action.op)} ${printValue(action.amount)}`;
        case "CHANGE_HUNGER":
            return `hungerLevel ${printOption(action.op)} ${printValue(action.amount)}`;
        case "CHANGE_MAX_HEALTH":
            return `maxHealth ${printOption(action.op)} ${printValue(action.amount)}`;
        case "CHANGE_VAR":
            return printActionChangeVar(action);
        case "CLEAR_POTION_EFFECTS":
            return "clearEffects";
        case "CLOSE_MENU":
            return "closeMenu";
        case "CONDITIONAL":
            return printActionConditional(action, depth, ctx);
        case "DROP_ITEM":
            return printActionDropItem(action, ctx);
        case "ENCHANT_HELD_ITEM":
            return `enchant ${printOption(action.enchant)} ${printNumber(action.level)}`;
        case "EXIT":
            return "exit";
        case "FAIL_PARKOUR": {
            return `failParkour ${quoteStringOrPlaceholder(action.message ?? "")}`;
        }
        case "PARKOUR_CHECKPOINT":
            return "parkCheck";
        case "FUNCTION": {
            const parts: string[] = ["function", quoteName(action.function)];
            if (action.global !== undefined) parts.push(printBoolean(action.global));
            return parts.join(" ");
        }
        case "GIVE_EXPERIENCE_LEVELS":
            return `xpLevel ${printValue(action.amount)}`;
        case "GIVE_ITEM": {
            ctx.diagnostics.push({
                level: "warning",
                message:
                    "GIVE_ITEM was emitted with a placeholder item name; HTSL has no syntax for inline item NBT.",
            });
            const parts: string[] = ["giveItem", quoteName(action.itemName || ITEM_PLACEHOLDER)];
            const tail: Array<string | undefined> = [
                action.allowMultiple !== undefined ? printBoolean(action.allowMultiple) : undefined,
                action.slot !== undefined ? printInventorySlot(action.slot) : undefined,
                action.replaceExisting !== undefined ? printBoolean(action.replaceExisting) : undefined,
            ];
            // Optional fields are positional: emit up to the last defined one,
            // filling earlier-undefined holes with sensible defaults.
            const lastDefined = lastIndexDefined(tail);
            for (let i = 0; i <= lastDefined; i++) {
                parts.push(tail[i] ?? defaultTailFor("giveItem", i));
            }
            return parts.join(" ");
        }
        case "HEAL":
            return "fullHeal";
        case "KILL":
            return "kill";
        case "LAUNCH":
            return `launchTarget ${printLocation(action.location)} ${printNumber(action.strength)}`;
        case "MESSAGE":
            return `chat ${quoteStringOrPlaceholder(action.message)}`;
        case "PAUSE":
            return `pause ${printNumber(action.ticks)}`;
        case "PLAY_SOUND": {
            const parts: string[] = ["sound", printSound(action.sound)];
            const tail: Array<string | undefined> = [
                action.volume !== undefined ? printNumber(action.volume) : undefined,
                action.pitch !== undefined ? printNumber(action.pitch) : undefined,
                action.location !== undefined ? printLocation(action.location) : undefined,
            ];
            const lastDefined = lastIndexDefined(tail);
            for (let i = 0; i <= lastDefined; i++) {
                if (tail[i] !== undefined) {
                    parts.push(tail[i] as string);
                } else if (i === 2) {
                    parts.push("null");
                } else {
                    parts.push(defaultTailFor("sound", i));
                }
            }
            return parts.join(" ");
        }
        case "RANDOM":
            return printActionRandom(action, depth, ctx);
        case "REMOVE_ITEM": {
            ctx.diagnostics.push({
                level: "warning",
                message:
                    "REMOVE_ITEM was emitted with a placeholder item name; HTSL has no syntax for inline item NBT.",
            });
            return `removeItem ${quoteName(action.itemName || ITEM_PLACEHOLDER)}`;
        }
        case "RESET_INVENTORY":
            return "resetInventory";
        case "SEND_TO_LOBBY": {
            const parts: string[] = ["lobby"];
            if (action.lobby !== undefined) parts.push(printOption(action.lobby));
            return parts.join(" ");
        }
        case "SET_COMPASS_TARGET":
            return `compassTarget ${printLocation(action.location)}`;
        case "SET_GAMEMODE":
            return `gamemode ${printOption(action.gamemode)}`;
        case "SET_GROUP": {
            const parts: string[] = ["changePlayerGroup", quoteString(action.group)];
            if (action.demotionProtection !== undefined)
                parts.push(printBoolean(action.demotionProtection));
            return parts.join(" ");
        }
        case "SET_MENU":
            return `displayMenu ${quoteName(action.menu)}`;
        case "SET_PLAYER_TIME":
            return `playerTime ${quoteString(action.time)}`;
        case "SET_PLAYER_WEATHER":
            return `playerWeather ${quoteString(action.weather)}`;
        case "SET_TEAM":
            return `setTeam ${quoteName(action.team)}`;
        case "SET_VELOCITY":
            return (
                "changeVelocity " +
                [printValue(action.x), printValue(action.y), printValue(action.z)].join(" ")
            );
        case "TELEPORT": {
            const parts: string[] = ["tp", printLocation(action.location)];
            if (action.preventTeleportInsideBlocks !== undefined)
                parts.push(printBoolean(action.preventTeleportInsideBlocks));
            return parts.join(" ");
        }
        case "TITLE":
            return printActionTitle(action);
        case "TOGGLE_NAMETAG_DISPLAY":
            return `displayNametag ${printBoolean(action.displayNametag)}`;
        case "USE_HELD_ITEM":
            return "consumeItem";
        default: {
            const _exhaustive: never = action;
            void _exhaustive;
            throw new Error(
                `printAction: unhandled action type ${(action as { type: string }).type}`
            );
        }
    }
}

function lastIndexDefined<T>(arr: Array<T | undefined>): number {
    let last = -1;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] !== undefined) last = i;
    }
    return last;
}

/**
 * Defaults used when a later optional field is set but an earlier one is not,
 * since the parser is positional. Emit the type's natural zero-value for the
 * missing slots so the parser is happy and the AST round-trips.
 */
function defaultTailFor(actionKw: string, index: number): string {
    if (actionKw === "giveItem") {
        // allowMultiple, slot, replaceExisting
        if (index === 0) return printBoolean(false);
        if (index === 1) return printInventorySlot("First Available Slot");
        if (index === 2) return printBoolean(false);
    }
    if (actionKw === "sound") {
        // volume, pitch, location
        if (index === 0) return "1";
        if (index === 1) return "1";
    }
    return "0";
}

function printActionChangeVar(action: Extract<Action, { type: "CHANGE_VAR" }>): string {
    const holder = action.holder;
    const kw =
        holder.type === "Global"
            ? "globalvar"
            : holder.type === "Team"
                ? "teamvar"
                : "var";
    const parts: string[] = [kw, quoteName(action.key)];
    if (holder.type === "Team") {
        parts.push(quoteName(holder.team ?? ""));
    }
    if (action.op === "Unset") {
        parts.push("unset");
        return parts.join(" ");
    }
    parts.push(OPERATION_SYMBOLS[action.op]);
    if (action.value !== undefined) parts.push(printValue(action.value));
    if (action.unset !== undefined) parts.push(printBoolean(action.unset));
    return parts.join(" ");
}

function printActionConditional(
    action: Extract<Action, { type: "CONDITIONAL" }>,
    depth: number,
    ctx: PrintActionsContext,
): string {
    // `matchAny=false` is the parser default when no mode keyword is present,
    // so we omit `and` and only emit `or` when explicitly any-match. This
    // preserves `if or ()` for empty-condition any-match blocks too, where
    // matchAny would otherwise be lost on round-trip.
    const mode = action.matchAny ? "or " : "";

    // If any condition has a note we MUST expand to multi-line so the
    // `///` line can sit above its condition — there's no comma-line form
    // that would let a note attach unambiguously to a single condition.
    const hasAnyNote = action.conditions.some(
        (c) => typeof c.note === "string" && c.note.length > 0
    );

    let head: string;
    if (!hasAnyNote) {
        const conds = action.conditions.map((c) => printCondition(c)).join(", ");
        head = `if ${mode}(${conds})`;
    } else {
        const eol = ctx.style.lineEnding;
        const innerPad = indent(depth + 1, ctx.style);
        const closePad = indent(depth, ctx.style);
        const lines: string[] = [];
        for (let i = 0; i < action.conditions.length; i++) {
            const cond = action.conditions[i];
            if (typeof cond.note === "string" && cond.note.length > 0) {
                lines.push(`${innerPad}/// ${normalizeNoteForEmit(cond.note)}`);
            }
            // Trailing comma on every line except the last — parser requires
            // commas between conditions, accepts newlines around them.
            const tail = i < action.conditions.length - 1 ? "," : "";
            lines.push(`${innerPad}${printCondition(cond)}${tail}`);
        }
        head = `if ${mode}(${eol}${lines.join(eol)}${eol}${closePad})`;
    }

    const ifBody = printBlock(action.ifActions, depth, ctx);
    let out = `${head} ${ifBody}`;

    if (action.elseActions && action.elseActions.length > 0) {
        const elseBody = printBlock(action.elseActions, depth, ctx);
        out += ` else ${elseBody}`;
    }

    return out;
}

function printActionRandom(
    action: Extract<Action, { type: "RANDOM" }>,
    depth: number,
    ctx: PrintActionsContext,
): string {
    const body = printBlock(action.actions, depth, ctx);
    return `random ${body}`;
}

/**
 * Emit `{ ... }` with newlines and inner indentation. Empty blocks become
 * `{}` on a single line.
 */
function printBlock(
    actions: readonly Action[],
    depth: number,
    ctx: PrintActionsContext,
): string {
    const eol = ctx.style.lineEnding;
    const pad = indent(depth, ctx.style);
    if (actions.length === 0) return "{}";
    const inner = printActionList(actions, depth + 1, ctx);
    return `{${eol}${inner}${pad}}`;
}

function printActionDropItem(
    action: Extract<Action, { type: "DROP_ITEM" }>,
    ctx: PrintActionsContext,
): string {
    ctx.diagnostics.push({
        level: "warning",
        message:
            "DROP_ITEM was emitted with a placeholder item name; HTSL has no syntax for inline item NBT.",
    });
    const parts: string[] = ["dropItem", quoteName(action.itemName || ITEM_PLACEHOLDER)];
    const tail: Array<string | undefined> = [
        action.location !== undefined ? printLocation(action.location) : undefined,
        action.dropNaturally !== undefined ? printBoolean(action.dropNaturally) : undefined,
        action.disableMerging !== undefined ? printBoolean(action.disableMerging) : undefined,
        action.prioritizePlayer !== undefined ? printBoolean(action.prioritizePlayer) : undefined,
        action.inventoryFallback !== undefined ? printBoolean(action.inventoryFallback) : undefined,
        action.despawnDurationTicks !== undefined ? printValue(action.despawnDurationTicks) : undefined,
        action.pickupDelayTicks !== undefined ? printValue(action.pickupDelayTicks) : undefined,
    ];
    const lastDefined = lastIndexDefined(tail);
    for (let i = 0; i <= lastDefined; i++) {
        if (tail[i] !== undefined) {
            parts.push(tail[i] as string);
        } else {
            // Defaults for missing positional fields. The parser order is:
            // location, dropNaturally, disableMerging, prioritizePlayer,
            // inventoryFallback, despawnDurationTicks, pickupDelayTicks.
            switch (i) {
                case 0: parts.push(printLocation({ type: "Current Location" })); break;
                case 1: parts.push(printBoolean(true)); break;
                case 2: parts.push(printBoolean(false)); break;
                case 3: parts.push(printBoolean(false)); break;
                case 4: parts.push(printBoolean(false)); break;
                case 5: parts.push("0"); break;
                case 6: parts.push("0"); break;
            }
        }
    }
    return parts.join(" ");
}

function printActionTitle(action: Extract<Action, { type: "TITLE" }>): string {
    const parts: string[] = ["title", quoteStringOrPlaceholder(action.title)];
    const tail: Array<string | undefined> = [
        action.subtitle !== undefined ? quoteStringOrPlaceholder(action.subtitle) : undefined,
        action.fadein !== undefined ? printNumber(action.fadein) : undefined,
        action.stay !== undefined ? printNumber(action.stay) : undefined,
        action.fadeout !== undefined ? printNumber(action.fadeout) : undefined,
    ];
    const lastDefined = lastIndexDefined(tail);
    if (lastDefined === -1) return parts.join(" ");

    // The parser requires fadein/stay/fadeout to all be present together,
    // so once any of them is set, fill missing ones with parser defaults.
    parts.push(tail[0] ?? quoteString(""));
    if (lastDefined >= 1) {
        parts.push(tail[1] ?? "1");
        parts.push(tail[2] ?? "5");
        parts.push(tail[3] ?? "1");
    }
    return parts.join(" ");
}
