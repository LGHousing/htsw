import { Diagnostic } from "../../diagnostic";
import { withDummyTypeSpans, type ActionKw } from "./helpers";
import type { IrAction, Spanned } from "../../ir";
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
import type { Parser } from "./parser";

type Note = Spanned<string> | undefined;

export function parseAction(p: Parser): IrAction {
    function eatKw(kw: ActionKw): boolean {
        return p.eatIdent(kw);
    }

    let note: Note;
    if (p.check("doc_comment")) {
        note = p.spanned(p.parseDocComment);
    }

    if (eatKw("actionBar")) {
        return parseActionActionBar(p, note);
    } else if (eatKw("applyLayout")) {
        return parseActionApplyInventoryLayout(p, note);
    } else if (eatKw("applyPotion")) {
        return parseActionApplyPotionEffect(p, note);
    } else if (eatKw("cancelEvent")) {
        return { type: "CANCEL_EVENT", typeSpan: p.prev.span, span: p.prev.span, note };
    } else if (eatKw("changeHealth")) {
        return parseActionChangeHealth(p, note);
    } else if (eatKw("changePlayerGroup")) {
        return parseActionSetGroup(p, note);
    } else if (eatKw("changeVelocity")) {
        return parseActionSetVelocity(p, note);
    } else if (eatKw("chat")) {
        return parseActionMessage(p, note);
    } else if (eatKw("clearEffects")) {
        return { type: "CLEAR_POTION_EFFECTS", typeSpan: p.prev.span, span: p.prev.span, note };
    } else if (eatKw("compassTarget")) {
        return parseActionSetCompassTarget(p, note);
    } else if (eatKw("displayMenu")) {
        return parseActionDisplayMenu(p, note);
    } else if (eatKw("dropItem")) {
        return parseActionDropItem(p, note);
    } else if (eatKw("enchant")) {
        return parseActionEnchantHeldItem(p, note);
    } else if (eatKw("exit")) {
        return { type: "EXIT", typeSpan: p.prev.span, span: p.prev.span, note };
    } else if (eatKw("failParkour")) {
        return parseActionFailParkour(p, note);
    } else if (eatKw("fullHeal")) {
        return { type: "HEAL", typeSpan: p.prev.span, span: p.prev.span, note };
    } else if (eatKw("function")) {
        return parseActionFunction(p, note);
    } else if (eatKw("gamemode")) {
        return parseActionSetGamemode(p, note);
    } else if (eatKw("giveItem")) {
        return parseActionGiveItem(p, note);
    } else if (eatKw("globalvar") || eatKw("globalstat")) {
        return parseActionChangeGlobalVar(p, note);
    } else if (eatKw("hungerLevel")) {
        return parseActionChangeHunger(p, note);
    } else if (eatKw("if")) {
        return parseActionConditional(p, note);
    } else if (eatKw("kill")) {
        return { type: "KILL", typeSpan: p.prev.span, span: p.prev.span, note };
    } else if (eatKw("launch")) {
        return parseActionLaunch(p, note);
    } else if (eatKw("lobby")) {
        return parseActionSendToLobby(p, note);
    } else if (eatKw("maxHealth")) {
        return parseActionChangeMaxHealth(p, note);
    } else if (eatKw("pause")) {
        return parseActionPause(p, note);
    } else if (eatKw("random")) {
        return parseActionRandom(p, note);
    } else if (eatKw("removeItem")) {
        return parseActionRemoveItem(p, note);
    } else if (eatKw("resetInventory")) {
        return { type: "RESET_INVENTORY", typeSpan: p.prev.span, span: p.prev.span, note };
    } else if (eatKw("setTeam")) {
        return parseActionSetTeam(p, note);
    } else if (eatKw("sound")) {
        return parseActionPlaySound(p, note);
    } else if (eatKw("teamvar") || eatKw("teamstat")) {
        return parseActionChangeTeamVar(p, note);
    } else if (eatKw("title")) {
        return parseActionTitle(p, note);
    } else if (eatKw("tp")) {
        return parseActionTeleport(p, note);
    } else if (eatKw("var") || eatKw("stat")) {
        return parseActionChangeVar(p, note);
    } else if (eatKw("xpLevel")) {
        return parseActionGiveExperienceLevels(p, note);
    }

    if (p.check("ident")) {
        const err = Diagnostic.error("Unknown action").addPrimarySpan(p.token.span);

        if (p.eatIdent("goto")) {
            err.addSubDiagnostic(
                Diagnostic.note("'goto' is no longer supported in htsw")
            );

            function addHelp(message: string) {
                err.addSubDiagnostic(Diagnostic.help(message));
            }

            // TODO: resolve actual import.json and make exhaustive
            if (p.eatIdent("function"))
                addHelp("Define this function separately in 'import.json'");
            else if (p.eatIdent("event"))
                addHelp("Define this event separately in 'import.json'");
        }

        // no need to recover to eol, parser already does this for actions
        throw err;
    }

    p.next();

    throw Diagnostic.error("Expected action").addPrimarySpan(p.prev.span);
}

function parseActionRecovering<T extends IrAction["type"]>(
    p: Parser,
    type: T,
    note: Note,
    parser: (action: IrAction & { type: T }) => void
): IrAction & { type: T } {
    const start = p.prev.span.start;
    const action = {
        type,
        typeSpan: p.prev.span,
        span: Span.dummy(), // placeholder
        note,
    } as Extract<IrAction, { type: T }>;
    p.parseRecovering(["eol"], () => {
        parser(action);
    });
    action.span = new Span(start, p.prev.span.end);
    return action;
}


function parseActionActionBar(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "ACTION_BAR", note, (action) => {
        action.message = p.spanned(p.parseString);
    });
}

function parseActionApplyInventoryLayout(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "APPLY_INVENTORY_LAYOUT", note, (action) => {
        action.layout = p.spanned(p.parseString);
    });
}

function parseActionApplyPotionEffect(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "APPLY_POTION_EFFECT", note, (action) => {
        action.effect = p.spanned(parsePotionEffect);
        action.duration = p.spanned(() => p.parseBoundedNumber(1, 2592000));
        action.level = p.spanned(() => p.parseBoundedNumber(1, 10));
        action.override = p.spanned(p.parseBoolean);
        if (p.checkEol()) return; // shorthand
        action.showIcon = p.spanned(p.parseBoolean);
    });
}

function parseActionChangeGlobalVar(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "CHANGE_VAR", note, (action) => {
        action.holder = p.spanned(
            () =>
                ({ type: "global", typeSpan: Span.dummy(), span: Span.dummy() }) as const
        );
        action.key = p.spanned(parseVarName);
        action.op = p.spanned(parseVarOperation);
        if (action.op?.value === "Unset") return;
        action.value = p.spanned(parseValue);
        if (p.checkEol()) return; // shorthand
        action.unset = p.spanned(p.parseBoolean);
    });
}

function parseActionChangeHealth(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "CHANGE_HEALTH", note, (action) => {
        action.op = p.spanned(parseOperation);
        action.amount = p.spanned(parseNumericValue);
    });
}

function parseActionChangeHunger(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "CHANGE_HUNGER", note, (action) => {
        action.op = p.spanned(parseOperation);
        action.amount = p.spanned(parseNumericValue);
    });
}

function parseActionChangeMaxHealth(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "CHANGE_HEALTH", note, (action) => {
        action.op = p.spanned(parseOperation);
        action.amount = p.spanned(parseNumericValue);
    });
}

function parseActionChangeTeamVar(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "CHANGE_VAR", note, (action) => {
        action.key = p.spanned(parseVarName);
        action.holder = p.spanned(() =>
            withDummyTypeSpans({ type: "team", team: p.spanned(p.parseName) } as const)
        );
        action.op = p.spanned(parseVarOperation);
        if (action.op?.value === "Unset") return;
        action.value = p.spanned(parseValue);
        if (p.checkEol()) return; // shorthand
        action.unset = p.spanned(p.parseBoolean);
    });
}

function parseActionChangeVar(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "CHANGE_VAR", note, (action) => {
        action.holder = p.spanned(() => withDummyTypeSpans({ type: "player" } as const));
        action.key = p.spanned(parseVarName);
        action.op = p.spanned(parseVarOperation);
        if (action.op?.value === "Unset") return;
        action.value = p.spanned(parseValue);
        if (p.checkEol()) return; // shorthand
        action.unset = p.spanned(p.parseBoolean);
    });
}

function parseActionConditional(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "CONDITIONAL", note, (action) => {
        action.matchAny = p.spanned(() => {
            if (p.eatIdent("and") || p.eatIdent("false")) return false;
            else if (p.eatIdent("or") || p.eatIdent("true")) return true;
            else if (p.check("ident"))
                throw Diagnostic.error("Expected conditional mode").addPrimarySpan(
                    p.token.span
                );
            else return false; // not null because :(
        });

        action.conditions = p.spanned(() => {
            return p
                .parseDelimitedCommaSeq("parenthesis", () => {
                    return p.parseRecovering(
                        ["comma", { kind: "close_delim", delim: "parenthesis" }],
                        () => {
                            return parseCondition(p);
                        }
                    );
                })
                .filter((it) => it !== undefined);
        });

        action.ifActions = p.spanned(p.parseBlock);

        // the following is kind of hacky, but it's alright:
        let token = p.token;
        let hadNewline = p.eat("eol");

        if (p.eatIdent("else")) {
            action.elseActions = p.spanned(p.parseBlock);
        } else if (hadNewline) {
            p.tokens.push(p.token);
            p.token = token;
        }
    });
}

function parseActionDisplayMenu(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "SET_MENU", note, (action) => {
        action.menu = p.spanned(p.parseName);
    });
}

function parseActionDropItem(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "DROP_ITEM", note, (action) => {
        action.item = p.spanned(p.parseName);
        action.location = p.spanned(parseLocation);
        action.dropNaturally = p.spanned(p.parseBoolean);
        action.disableMerging = p.spanned(p.parseBoolean);
        action.prioritizePlayer = p.spanned(p.parseBoolean);
        action.inventoryFallback = p.spanned(p.parseBoolean);
    });
}

function parseActionEnchantHeldItem(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "ENCHANT_HELD_ITEM", note, (action) => {
        action.enchant = p.spanned(parseEnchantment);
        action.level = p.spanned(() => p.parseBoundedNumber(1, 10));
    });
}

function parseActionFailParkour(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "FAIL_PARKOUR", note, (action) => {
        action.message = p.spanned(p.parseString);
    });
}

function parseActionFunction(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "FUNCTION", note, (action) => {
        action.function = p.spanned(p.parseName);
        if (p.checkEol()) return; // shorthand
        action.global = p.spanned(p.parseBoolean);
    });
}

function parseActionGiveExperienceLevels(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "GIVE_EXPERIENCE_LEVELS", note, (action) => {
        action.amount = p.spanned(parseNumericValue);
    });
}

function parseActionGiveItem(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "GIVE_ITEM", note, (action) => {
        action.item = p.spanned(p.parseName);
        action.allowMultiple = p.spanned(p.parseBoolean);
        action.slot = p.spanned(parseInventorySlot);
        action.replaceExisting = p.spanned(p.parseBoolean);
    });
}

function parseActionLaunch(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "LAUNCH", note, (action) => {
        action.location = p.spanned(parseLocation);
        action.strength = p.spanned(() => p.parseBoundedNumber(1, 10));
    });
}

function parseActionMessage(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "MESSAGE", note, (action) => {
        action.message = p.spanned(p.parseString);
    });
}

function parseActionPause(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "PAUSE", note, (action) => {
        action.ticks = p.spanned(() => p.parseBoundedNumber(1, 1000));
    });
}

function parseActionPlaySound(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "PLAY_SOUND", note, (action) => {
        action.sound = p.spanned(parseSound);
        action.volume = p.spanned(p.parseDouble);
        action.pitch = p.spanned(p.parseDouble);
        action.location = p.spanned(parseLocation);
    });
}

function parseActionRandom(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "RANDOM", note, (action) => {
        action.actions = p.spanned(p.parseBlock);
    });
}

function parseActionRemoveItem(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "REMOVE_ITEM", note, (action) => {
        action.item = p.spanned(p.parseName);
    });
}

function parseActionSendToLobby(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "SEND_TO_LOBBY", note, (action) => {
        action.lobby = p.spanned(parseLobby);
    });
}

function parseActionSetCompassTarget(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "SET_COMPASS_TARGET", note, (action) => {
        action.location = p.spanned(parseLocation);
    });
}

function parseActionSetGamemode(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "SET_GAMEMODE", note, (action) => {
        action.gamemode = p.spanned(parseGamemode);
    });
}

function parseActionSetGroup(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "SET_GROUP", note, (action) => {
        action.group = p.spanned(p.parseString);
        if (p.checkEol()) return;
        action.demotionProtection = p.spanned(p.parseBoolean);
    });
}

function parseActionSetTeam(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "SET_TEAM", note, (action) => {
        action.team = p.spanned(p.parseName);
    });
}

function parseActionSetVelocity(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "SET_VELOCITY", note, (action) => {
        action.x = p.spanned(parseNumericValue);
        action.y = p.spanned(parseNumericValue);
        action.z = p.spanned(parseNumericValue);
    });
}

function parseActionTeleport(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "TELEPORT", note, (action) => {
        action.location = p.spanned(parseLocation);
    });
}

function parseActionTitle(p: Parser, note: Note): IrAction {
    return parseActionRecovering(p, "TITLE", note, (action) => {
        action.title = p.spanned(p.parseString);
        if (p.checkEol()) return; // shorthand
        action.subtitle = p.spanned(p.parseString);
        if (p.checkEol()) return; // shorthand

        action.fadein = p.spanned(() => p.parseBoundedNumber(0, 5));
        action.stay = p.spanned(() => p.parseBoundedNumber(0, 10));
        action.fadeout = p.spanned(() => p.parseBoundedNumber(0, 5));
    });
}
