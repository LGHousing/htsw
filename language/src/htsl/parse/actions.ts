import { Diagnostic } from "../../diagnostic";
import type { Action } from "../../types";
import { Span } from "../../span";
import {
    parseEnchantment,
    parseGamemode,
    parseInventorySlot,
    parseLobby,
    parseLocation,
    parseNumericValue,
    parseOperation,
    parsePotionEffect,
    parseSound,
    parseValue,
    parseVarName,
    parseVarOperation,
} from "./arguments";
import { parseCondition } from "./conditions";
import { type ActionKw } from "./helpers";
import type { Parser } from "./parser";

type Note = { value: string; span: Span } | undefined;

function setField<T extends object, K extends keyof T>(
    p: Parser,
    node: T,
    key: K,
    parser: ((p: Parser) => T[K]) | (() => T[K]),
): T[K] {
    const { value, span } = p.spanned(parser as any) as { value: T[K]; span: Span };
    node[key] = value;
    p.gcx.spans.setField(node, key, span);
    return value;
}

function setFieldWithSpan<T extends object, K extends keyof T>(
    p: Parser,
    node: T,
    key: K,
    value: T[K],
    span: Span,
) {
    node[key] = value;
    p.gcx.spans.setField(node, key, span);
}

function setNodeSpan(p: Parser, node: object, span: Span) {
    p.gcx.spans.set(node, span);
}

function setNote<T extends { note?: string }>(p: Parser, node: T, note: Note) {
    if (!note) return;
    setFieldWithSpan(p, node, "note", note.value.trim(), note.span);
}

type ActionParser = (p: Parser, note: Note) => Action;

const ACTION_PARSER_ENTRIES: [ActionKw, ActionParser][] = [
    ["actionBar", parseActionActionBar],
    ["applyLayout", parseActionApplyInventoryLayout],
    ["applyPotion", parseActionApplyPotionEffect],
    ["cancelEvent", (p, note) => parseSimpleAction(p, "CANCEL_EVENT", note)],
    ["changeHealth", parseActionChangeHealth],
    ["changePlayerGroup", parseActionSetGroup],
    ["changeVelocity", parseActionSetVelocity],
    ["chat", parseActionMessage],
    ["clearEffects", (p, note) => parseSimpleAction(p, "CLEAR_POTION_EFFECTS", note)],
    ["closeMenu", (p, note) => parseSimpleAction(p, "CLOSE_MENU", note)],
    ["compassTarget", parseActionSetCompassTarget],
    ["displayMenu", parseActionDisplayMenu],
    ["dropItem", parseActionDropItem],
    ["enchant", parseActionEnchantHeldItem],
    ["exit", (p, note) => parseSimpleAction(p, "EXIT", note)],
    ["failParkour", parseActionFailParkour],
    ["fullHeal", (p, note) => parseSimpleAction(p, "HEAL", note)],
    ["parkCheck", (p, note) => parseSimpleAction(p, "PARKOUR_CHECKPOINT", note)],
    ["function", parseActionFunction],
    ["gamemode", parseActionSetGamemode],
    ["giveItem", parseActionGiveItem],
    ["globalvar", parseActionChangeGlobalVar],
    ["globalstat", parseActionChangeGlobalVar],
    ["hungerLevel", parseActionChangeHunger],
    ["if", parseActionConditional],
    ["kill", (p, note) => parseSimpleAction(p, "KILL", note)],
    ["launchTarget", parseActionLaunch],
    ["lobby", parseActionSendToLobby],
    ["maxHealth", parseActionChangeMaxHealth],
    ["pause", parseActionPause],
    ["random", parseActionRandom],
    ["removeItem", parseActionRemoveItem],
    ["resetInventory", (p, note) => parseSimpleAction(p, "RESET_INVENTORY", note)],
    ["setTeam", parseActionSetTeam],
    ["sound", parseActionPlaySound],
    ["teamvar", parseActionChangeTeamVar],
    ["teamstat", parseActionChangeTeamVar],
    ["title", parseActionTitle],
    ["tp", parseActionTeleport],
    ["consumeItem", (p, note) => parseSimpleAction(p, "USE_HELD_ITEM", note)],
    ["var", parseActionChangeVar],
    ["stat", parseActionChangeVar],
    ["playerWeather", parseActionSetPlayerWeather],
    ["playerTime", parseActionSetPlayerTime],
    ["displayNametag", parseActionToggleNametagDisplay],
    ["xpLevel", parseActionGiveExperienceLevels],
];

const ACTION_PARSERS = new Map<string, ActionParser>(ACTION_PARSER_ENTRIES);

export function parseAction(p: Parser): Action {
    let note: Note;
    if (p.check("doc_comment")) {
        note = p.spanned(p.parseDocComment);
        p.eat("eol");
    }

    const tok = p.token;
    if (tok.kind === "ident") {
        const handler = ACTION_PARSERS.get(tok.value);
        if (handler !== undefined) {
            p.next();
            return handler(p, note);
        }

        const err = Diagnostic.error("Unknown action").addPrimarySpan(tok.span);

        if (p.eatIdent("goto")) {
            err.addSubDiagnostic(
                Diagnostic.note("'goto' is no longer supported in htsw")
            );

            function addHelp(message: string) {
                err.addSubDiagnostic(Diagnostic.help(message));
            }

            if (p.eatIdent("function"))
                addHelp("Define this function separately in 'import.json'");
            else if (p.eatIdent("event"))
                addHelp("Define this event separately in 'import.json'");
        }

        throw err;
    }

    p.next();

    throw Diagnostic.error("Expected action").addPrimarySpan(p.prev.span);
}

function parseSimpleAction<T extends Action["type"]>(
    p: Parser,
    type: T,
    note: Note,
): Extract<Action, { type: T }> {
    const action = { type } as Extract<Action, { type: T }>;
    const typeSpan = p.prev.span;
    setNote(p, action, note);
    setNodeSpan(p, action, typeSpan);
    p.gcx.spans.setField(action, "type", typeSpan);
    return action;
}

function parseActionRecovering<T extends Action["type"]>(
    p: Parser,
    type: T,
    note: Note,
    parser: (action: Extract<Action, { type: T }>) => void
): Extract<Action, { type: T }> {
    const start = p.prev.span.start;
    const typeSpan = p.prev.span;
    const action = { type } as Extract<Action, { type: T }>;

    p.gcx.spans.setField(action, "type", typeSpan);
    setNote(p, action, note);

    p.gcx.spans.setField(action, "type", typeSpan);

    p.parseRecovering(["eol"], () => {
        parser(action);
    });

    setNodeSpan(p, action, new Span(start, p.prev.span.end));
    return action;
}

function parseActionActionBar(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "ACTION_BAR", note, (action) => {
        setField(p, action, "message", p.parseString);
    });
}

function parseActionApplyInventoryLayout(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "APPLY_INVENTORY_LAYOUT", note, (action) => {
        setField(p, action, "layout", p.parseString);
    });
}

function parseActionApplyPotionEffect(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "APPLY_POTION_EFFECT", note, (action) => {
        setField(p, action, "effect", parsePotionEffect);
        setField(p, action, "duration", () => p.parseBoundedNumber(1, 2592000));
        setField(p, action, "level", () => p.parseBoundedNumber(1, 10));
        setField(p, action, "override", p.parseBoolean);
        if (p.checkEol()) return;
        setField(p, action, "showIcon", p.parseBoolean);
    });
}

function parseActionChangeGlobalVar(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "CHANGE_VAR", note, (action) => {
        setFieldWithSpan(p, action, "holder", { type: "Global" }, p.prev.span);
        setField(p, action, "key", parseVarName);
        const op = setField(p, action, "op", parseVarOperation);
        if (op === "Unset") return;
        setField(p, action, "value", parseValue);
        if (p.checkEol()) return;
        setField(p, action, "unset", p.parseBoolean);
    });
}

function parseActionChangeHealth(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "CHANGE_HEALTH", note, (action) => {
        setField(p, action, "op", parseOperation);
        setField(p, action, "amount", parseNumericValue);
    });
}

function parseActionChangeHunger(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "CHANGE_HUNGER", note, (action) => {
        setField(p, action, "op", parseOperation);
        setField(p, action, "amount", parseNumericValue);
    });
}

function parseActionChangeMaxHealth(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "CHANGE_MAX_HEALTH", note, (action) => {
        setField(p, action, "op", parseOperation);
        setField(p, action, "amount", parseNumericValue);
    });
}

function parseActionChangeTeamVar(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "CHANGE_VAR", note, (action) => {
        setField(p, action, "key", parseVarName);
        const teamSpan = p.token.span;
        const team = p.parseName();
        const holder = { type: "Team", team } as const;
        setFieldWithSpan(p, action, "holder", holder, teamSpan.to(p.prev.span));
        const op = setField(p, action, "op", parseVarOperation);
        if (op === "Unset") return;
        setField(p, action, "value", parseValue);
        if (p.checkEol()) return;
        setField(p, action, "unset", p.parseBoolean);
    });
}

function parseActionChangeVar(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "CHANGE_VAR", note, (action) => {
        setFieldWithSpan(p, action, "holder", { type: "Player" }, p.prev.span);
        setField(p, action, "key", parseVarName);
        const op = setField(p, action, "op", parseVarOperation);
        if (op === "Unset") return;
        setField(p, action, "value", parseValue);
        if (p.checkEol()) return;
        setField(p, action, "unset", p.parseBoolean);
    });
}

function parseActionConditional(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "CONDITIONAL", note, (action) => {
        setField(p, action, "matchAny", () => {
            if (p.eatIdent("and") || p.eatIdent("false")) return false;
            if (p.eatIdent("or") || p.eatIdent("true")) return true;
            if (p.check("ident")) {
                throw Diagnostic.error("Expected conditional mode").addPrimarySpan(
                    p.token.span
                );
            }
            return false;
        });

        setField(p, action, "conditions", () => {
            return p
                .parseDelimitedCommaSeq("parenthesis", () => {
                    return p.parseRecovering(
                        ["comma", { kind: "close_delim", delim: "parenthesis" }],
                        () => parseCondition(p)
                    );
                })
                .filter((it): it is NonNullable<typeof it> => it !== undefined);
        });

        setField(p, action, "ifActions", p.parseBlock);

        const token = p.token;
        const hadNewline = p.eat("eol");

        if (p.eatIdent("else")) {
            setField(p, action, "elseActions", p.parseBlock);
        } else {
            action.elseActions = [];
            if (hadNewline) {
                p.tokens.push(p.token);
                p.token = token;
            }
        }
    });
}

function parseActionDisplayMenu(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "SET_MENU", note, (action) => {
        setField(p, action, "menu", p.parseName);
    });
}

function parseActionDropItem(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "DROP_ITEM", note, (action) => {
        setField(p, action, "itemName", p.parseName);
        if (p.checkEol()) return;
        if (p.eatIdent("null") || p.eatString("null")) {
            if (p.checkEol()) return;
        } else {
            setField(p, action, "location", parseLocation);
            if (p.checkEol()) return;
        }
        setField(p, action, "dropNaturally", p.parseBoolean);
        if (p.checkEol()) return;
        setField(p, action, "disableMerging", p.parseBoolean);
        if (p.checkEol()) return;
        setField(p, action, "prioritizePlayer", p.parseBoolean);
        if (p.checkEol()) return;
        setField(p, action, "inventoryFallback", p.parseBoolean);
        if (p.checkEol()) return;
        setField(p, action, "despawnDurationTicks", parseNumericValue);
        if (p.checkEol()) return;
        setField(p, action, "pickupDelayTicks", parseNumericValue);
    });
}

function parseActionEnchantHeldItem(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "ENCHANT_HELD_ITEM", note, (action) => {
        setField(p, action, "enchant", parseEnchantment);
        setField(p, action, "level", () => p.parseBoundedNumber(1, 10));
    });
}

function parseActionFailParkour(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "FAIL_PARKOUR", note, (action) => {
        setField(p, action, "message", p.parseString);
    });
}

function parseActionFunction(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "FUNCTION", note, (action) => {
        setField(p, action, "function", p.parseName);
        if (p.checkEol()) return;
        setField(p, action, "global", p.parseBoolean);
    });
}

function parseActionGiveExperienceLevels(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "GIVE_EXPERIENCE_LEVELS", note, (action) => {
        setField(p, action, "amount", parseNumericValue);
    });
}

function parseActionGiveItem(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "GIVE_ITEM", note, (action) => {
        setField(p, action, "itemName", p.parseName);
        if (p.checkEol()) return;
        setField(p, action, "allowMultiple", p.parseBoolean);
        if (p.checkEol()) return;
        setField(p, action, "slot", parseInventorySlot);
        if (p.checkEol()) return;
        setField(p, action, "replaceExisting", p.parseBoolean);
    });
}

function parseActionLaunch(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "LAUNCH", note, (action) => {
        setField(p, action, "location", parseLocation);
        setField(p, action, "strength", () => p.parseBoundedNumber(1, 10));
    });
}

function parseActionMessage(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "MESSAGE", note, (action) => {
        setField(p, action, "message", p.parseString);
    });
}

function parseActionPause(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "PAUSE", note, (action) => {
        setField(p, action, "ticks", () => p.parseBoundedNumber(1, 1000));
    });
}

function parseActionPlaySound(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "PLAY_SOUND", note, (action) => {
        setField(p, action, "sound", parseSound);
        if (p.checkEol()) return;
        setField(p, action, "volume", p.parseDouble);
        if (p.checkEol()) return;
        setField(p, action, "pitch", p.parseDouble);
        if (p.checkEol()) return;
        if (p.eatIdent("null") || p.eatString("null")) return;
        setField(p, action, "location", parseLocation);
    });
}

function parseActionRandom(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "RANDOM", note, (action) => {
        setField(p, action, "actions", p.parseBlock);
    });
}

function parseActionRemoveItem(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "REMOVE_ITEM", note, (action) => {
        setField(p, action, "itemName", p.parseName);
    });
}

function parseActionSendToLobby(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "SEND_TO_LOBBY", note, (action) => {
        setField(p, action, "lobby", parseLobby);
    });
}

function parseActionSetCompassTarget(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "SET_COMPASS_TARGET", note, (action) => {
        setField(p, action, "location", parseLocation);
    });
}

function parseActionSetGamemode(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "SET_GAMEMODE", note, (action) => {
        setField(p, action, "gamemode", parseGamemode);
    });
}

function parseActionSetGroup(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "SET_GROUP", note, (action) => {
        setField(p, action, "group", p.parseString);
        if (p.checkEol()) return;
        setField(p, action, "demotionProtection", p.parseBoolean);
    });
}

function parseActionSetTeam(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "SET_TEAM", note, (action) => {
        setField(p, action, "team", p.parseName);
    });
}

function parseActionSetPlayerWeather(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "SET_PLAYER_WEATHER", note, (action) => {
        setField(p, action, "weather", p.parseString);
    });
}

function parseActionSetPlayerTime(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "SET_PLAYER_TIME", note, (action) => {
        setField(p, action, "time", p.parseString);
    });
}

function parseActionToggleNametagDisplay(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "TOGGLE_NAMETAG_DISPLAY", note, (action) => {
        setField(p, action, "displayNametag", p.parseBoolean);
    });
}

function parseActionSetVelocity(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "SET_VELOCITY", note, (action) => {
        setField(p, action, "x", parseNumericValue);
        setField(p, action, "y", parseNumericValue);
        setField(p, action, "z", parseNumericValue);
    });
}

function parseActionTeleport(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "TELEPORT", note, (action) => {
        setField(p, action, "location", parseLocation);
        if (p.checkEol()) return;
        setField(p, action, "preventTeleportInsideBlocks", p.parseBoolean);
    });
}

function parseActionTitle(p: Parser, note: Note): Action {
    return parseActionRecovering(p, "TITLE", note, (action) => {
        setField(p, action, "title", p.parseString);
        if (p.checkEol()) return;
        setField(p, action, "subtitle", p.parseString);
        if (p.checkEol()) return;
        setField(p, action, "fadein", () => p.parseBoundedNumber(0, 5));
        setField(p, action, "stay", () => p.parseBoundedNumber(0, 10));
        setField(p, action, "fadeout", () => p.parseBoundedNumber(0, 5));
    });
}
