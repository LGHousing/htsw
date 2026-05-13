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

/**
 * Half-open character range tagged with the AST field it covers. Emitted
 * alongside the printed text by `printActionHeadSpans` so consumers (e.g.
 * the in-game code view) can underline or focus individual fields without
 * re-parsing the output.
 */
export type FieldSpan = {
    prop: string;
    start: number;
    end: number;
};

/**
 * Text part with optional field-prop tag. Joined with a separator by
 * `joinParts` to produce both the final string AND the field-span list.
 * Untagged parts (no `prop`) are pure plumbing — keywords, punctuation,
 * separators.
 */
type Part = { text: string; prop?: string };

/** Join parts with `sep`, accumulating spans for tagged parts. */
function joinParts(parts: readonly Part[], sep: string): { text: string; fieldSpans: FieldSpan[] } {
    let text = "";
    const fieldSpans: FieldSpan[] = [];
    for (let i = 0; i < parts.length; i++) {
        if (i > 0) text += sep;
        const p = parts[i];
        const start = text.length;
        text += p.text;
        if (p.prop !== undefined) {
            fieldSpans.push({ prop: p.prop, start, end: text.length });
        }
    }
    return { text, fieldSpans };
}

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
 * Like `printActionHead` but also returns per-field character ranges.
 * Coverage is opportunistic: action types with explicit Part-based
 * handlers below carry field spans; others fall back to the plain text
 * with no spans (graceful — consumers treat missing spans as "no
 * underlines to draw" without crashing).
 *
 * For block-bearing actions (CONDITIONAL, RANDOM) the field spans cover
 * only the head text up to the opening `{` — nested action lines are
 * tracked separately by the caller.
 */
export function printActionHeadSpans(
    action: Action,
    depth: number,
    ctx: PrintActionsContext,
): { text: string; fieldSpans: FieldSpan[] } {
    switch (action.type) {
        case "ACTION_BAR":
            return joinParts(
                [{ text: "actionBar" }, { text: quoteStringOrPlaceholder(action.message), prop: "message" }],
                " "
            );
        case "APPLY_INVENTORY_LAYOUT":
            return joinParts(
                [{ text: "applyLayout" }, { text: quoteStringOrPlaceholder(action.layout), prop: "layout" }],
                " "
            );
        case "CHANGE_HEALTH":
            return joinParts(
                [
                    { text: "changeHealth" },
                    { text: printOption(action.op), prop: "op" },
                    { text: printValue(action.amount), prop: "amount" },
                ],
                " "
            );
        case "CHANGE_HUNGER":
            return joinParts(
                [
                    { text: "hungerLevel" },
                    { text: printOption(action.op), prop: "op" },
                    { text: printValue(action.amount), prop: "amount" },
                ],
                " "
            );
        case "CHANGE_MAX_HEALTH":
            return joinParts(
                [
                    { text: "maxHealth" },
                    { text: printOption(action.op), prop: "op" },
                    { text: printValue(action.amount), prop: "amount" },
                ],
                " "
            );
        case "ENCHANT_HELD_ITEM":
            return joinParts(
                [
                    { text: "enchant" },
                    { text: printOption(action.enchant), prop: "enchant" },
                    { text: printNumber(action.level), prop: "level" },
                ],
                " "
            );
        case "FAIL_PARKOUR":
            return joinParts(
                [
                    { text: "failParkour" },
                    { text: quoteStringOrPlaceholder(action.message ?? ""), prop: "message" },
                ],
                " "
            );
        case "GIVE_EXPERIENCE_LEVELS":
            return joinParts(
                [{ text: "xpLevel" }, { text: printValue(action.amount), prop: "amount" }],
                " "
            );
        case "MESSAGE":
            return joinParts(
                [{ text: "chat" }, { text: quoteStringOrPlaceholder(action.message), prop: "message" }],
                " "
            );
        case "PAUSE":
            return joinParts(
                [{ text: "pause" }, { text: printNumber(action.ticks), prop: "ticks" }],
                " "
            );
        case "SET_COMPASS_TARGET":
            return joinParts(
                [{ text: "compassTarget" }, { text: printLocation(action.location), prop: "location" }],
                " "
            );
        case "SET_GAMEMODE":
            return joinParts(
                [{ text: "gamemode" }, { text: printOption(action.gamemode), prop: "gamemode" }],
                " "
            );
        case "SET_MENU":
            return joinParts(
                [{ text: "displayMenu" }, { text: quoteName(action.menu), prop: "menu" }],
                " "
            );
        case "SET_PLAYER_TIME":
            return joinParts(
                [{ text: "playerTime" }, { text: quoteString(action.time), prop: "time" }],
                " "
            );
        case "SET_PLAYER_WEATHER":
            return joinParts(
                [{ text: "playerWeather" }, { text: quoteString(action.weather), prop: "weather" }],
                " "
            );
        case "SET_TEAM":
            return joinParts(
                [{ text: "setTeam" }, { text: quoteName(action.team), prop: "team" }],
                " "
            );
        case "SET_VELOCITY":
            return joinParts(
                [
                    { text: "changeVelocity" },
                    { text: printValue(action.x), prop: "x" },
                    { text: printValue(action.y), prop: "y" },
                    { text: printValue(action.z), prop: "z" },
                ],
                " "
            );
        case "TELEPORT": {
            const parts: Part[] = [
                { text: "tp" },
                { text: printLocation(action.location), prop: "location" },
            ];
            if (action.preventTeleportInsideBlocks !== undefined) {
                parts.push({
                    text: printBoolean(action.preventTeleportInsideBlocks),
                    prop: "preventTeleportInsideBlocks",
                });
            }
            return joinParts(parts, " ");
        }
        case "TITLE": {
            const parts: Part[] = [
                { text: "title" },
                { text: quoteStringOrPlaceholder(action.title), prop: "title" },
            ];
            const optionalGroup: Part[] = [];
            if (action.subtitle !== undefined) {
                optionalGroup.push({ text: quoteStringOrPlaceholder(action.subtitle), prop: "subtitle" });
            }
            const fadeFields = action.fadein !== undefined || action.stay !== undefined || action.fadeout !== undefined;
            if (fadeFields) {
                if (optionalGroup.length === 0) optionalGroup.push({ text: quoteString("") });
                optionalGroup.push({ text: printNumber(action.fadein ?? 1), prop: "fadein" });
                optionalGroup.push({ text: printNumber(action.stay ?? 5), prop: "stay" });
                optionalGroup.push({ text: printNumber(action.fadeout ?? 1), prop: "fadeout" });
            }
            return joinParts(parts.concat(optionalGroup), " ");
        }
        case "TOGGLE_NAMETAG_DISPLAY":
            return joinParts(
                [{ text: "displayNametag" }, { text: printBoolean(action.displayNametag), prop: "displayNametag" }],
                " "
            );
        // Actions without bespoke span handling — fall back to plain text.
        default:
            return { text: printActionHead(action, depth, ctx), fieldSpans: [] };
    }
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
