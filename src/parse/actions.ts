import type { VarHolder } from 'housing-common';
import { error } from '../diagnostic';
import type { ActionKw } from '../helpers';
import type { IrAction } from '../ir';
import { Span } from '../span';
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
} from './arguments';
import { parseCondition } from './conditions';
import type { Parser } from './parser';

export function parseAction(p: Parser): IrAction {
    function eatKw(kw: ActionKw): boolean {
        return p.eatIdent(kw);
    }

    if (eatKw('actionBar')) {
        return parseActionActionBar(p);
    } else if (eatKw('applyLayout')) {
        return parseActionApplyInventoryLayout(p);
    } else if (eatKw('applyPotion')) {
        return parseActionApplyPotionEffect(p);
    } else if (eatKw('cancelEvent')) {
        return { type: 'CANCEL_EVENT', kwSpan: p.prev.span, span: p.prev.span };
    } else if (eatKw('changeHealth')) {
        return parseActionChangeHealth(p);
    } else if (eatKw('changePlayerGroup')) {
        return parseActionSetGroup(p);
    } else if (eatKw('changeVelocity')) {
        return parseActionSetVelocity(p);
    } else if (eatKw('chat')) {
        return parseActionMessage(p);
    } else if (eatKw('clearEffects')) {
        return { type: 'CLEAR_POTION_EFFECTS', kwSpan: p.prev.span, span: p.prev.span };
    } else if (eatKw('compassTarget')) {
        return parseActionSetCompassTarget(p);
    } else if (eatKw('displayMenu')) {
        return parseActionDisplayMenu(p);
    } else if (eatKw('dropItem')) {
        return parseActionDropItem(p);
    } else if (eatKw('enchant')) {
        return parseActionEnchantHeldItem(p);
    } else if (eatKw('exit')) {
        return { type: 'EXIT', kwSpan: p.prev.span, span: p.prev.span };
    } else if (eatKw('failParkour')) {
        return parseActionFailParkour(p);
    } else if (eatKw('fullHeal')) {
        return { type: 'HEAL', kwSpan: p.prev.span, span: p.prev.span };
    } else if (eatKw('function')) {
        return parseActionFunction(p);
    } else if (eatKw('gamemode')) {
        return parseActionSetGamemode(p);
    } else if (eatKw('giveItem')) {
        return parseActionGiveItem(p);
    } else if (eatKw('globalstat')) {
        return parseActionChangeGlobalVar(p);
    } else if (eatKw('globalvar')) {
        return parseActionChangeGlobalVar(p);
    } else if (eatKw('hungerLevel')) {
        return parseActionChangeHunger(p);
    } else if (eatKw('if')) {
        return parseActionConditional(p);
    } else if (eatKw('kill')) {
        return { type: 'KILL', kwSpan: p.prev.span, span: p.prev.span };
    } else if (eatKw('launch')) {
        return parseActionLaunch(p);
    } else if (eatKw('lobby')) {
        return parseActionSendToLobby(p);
    } else if (eatKw('maxHealth')) {
        return parseActionChangeMaxHealth(p);
    } else if (eatKw('pause')) {
        return parseActionPause(p);
    } else if (eatKw('random')) {
        return parseActionRandom(p);
    } else if (eatKw('removeItem')) {
        return parseActionRemoveItem(p);
    } else if (eatKw('resetInventory')) {
        return { type: 'RESET_INVENTORY', kwSpan: p.prev.span, span: p.prev.span };
    } else if (eatKw('setTeam')) {
        return parseActionSetTeam(p);
    } else if (eatKw('sound')) {
        return parseActionPlaySound(p);
    } else if (eatKw('stat')) {
        return parseActionChangeVar(p);
    } else if (eatKw('teamstat')) {
        return parseActionChangeTeamVar(p);
    } else if (eatKw('teamvar')) {
        return parseActionChangeTeamVar(p);
    } else if (eatKw('title')) {
        return parseActionTitle(p);
    } else if (eatKw('tp')) {
        return parseActionTeleport(p);
    } else if (eatKw('var')) {
        return parseActionChangeVar(p);
    } else if (eatKw('xpLevel')) {
        return parseActionGiveExperienceLevels(p);
    }

    if (p.check('ident')) {
        throw error('Unknown action', p.token.span);
    }

    p.next();
    throw error('Expected action', p.prev.span);
}

function parseActionActionBar(p: Parser): IrAction {
    return parseActionRecovering(p, 'ACTION_BAR', (action) => {
        action.message = p.spanned(p.parseString);
    });
}

function parseActionApplyInventoryLayout(p: Parser): IrAction {
    return parseActionRecovering(p, 'APPLY_INVENTORY_LAYOUT', (action) => {
        action.layout = p.spanned(p.parseString);
    });
}

function parseActionApplyPotionEffect(p: Parser): IrAction {
    return parseActionRecovering(p, 'APPLY_POTION_EFFECT', (action) => {
        action.effect = p.spanned(parsePotionEffect);
        action.duration = p.spanned(() => p.parseBoundedNumber(1, 2592000));
        action.level = p.spanned(() => p.parseBoundedNumber(1, 10));
        action.override = p.spanned(p.parseBoolean);
        if (p.checkEol()) return; // shorthand
        action.showIcon = p.spanned(p.parseBoolean);
    });
}

function parseActionChangeGlobalVar(p: Parser): IrAction {
    return parseActionRecovering(p, 'CHANGE_VAR', (action) => {
        action.holder = p.spanned(() => ({ type: 'global' } as VarHolder));
        action.var = p.spanned(parseVarName);
        action.op = p.spanned(parseVarOperation);
        action.value = p.spanned(parseValue);
        if (p.checkEol()) return; // shorthand
        action.unset = p.spanned(p.parseBoolean);
    });
}

function parseActionChangeHealth(p: Parser): IrAction {
    return parseActionRecovering(p, 'CHANGE_HEALTH', (action) => {
        action.op = p.spanned(parseOperation);
        action.amount = p.spanned(parseNumericValue);
    });
}

function parseActionChangeHunger(p: Parser): IrAction {
    return parseActionRecovering(p, 'CHANGE_HUNGER', (action) => {
        action.op = p.spanned(parseOperation);
        action.amount = p.spanned(parseNumericValue);
    });
}

function parseActionChangeMaxHealth(p: Parser): IrAction {
    return parseActionRecovering(p, 'CHANGE_HEALTH', (action) => {
        action.op = p.spanned(parseOperation);
        action.amount = p.spanned(parseNumericValue);
    });
}

function parseActionChangeTeamVar(p: Parser): IrAction {
    return parseActionRecovering(p, 'CHANGE_VAR', (action) => {
        action.var = p.spanned(parseVarName);
        action.holder = p.spanned(() => ({ type: 'team', team: p.parseName() }) as VarHolder);
        action.op = p.spanned(parseVarOperation);
        action.value = p.spanned(parseValue);
        if (p.checkEol()) return; // shorthand
        action.unset = p.spanned(p.parseBoolean);
    });
}

function parseActionChangeVar(p: Parser): IrAction {
    return parseActionRecovering(p, 'CHANGE_VAR', (action) => {
        action.holder = p.spanned(() => ({ type: 'player' }) as VarHolder);
        action.var = p.spanned(parseVarName);
        action.op = p.spanned(parseVarOperation);
        action.value = p.spanned(parseValue);
        if (p.checkEol()) return; // shorthand
        action.unset = p.spanned(p.parseBoolean);
    });
}

function parseActionConditional(p: Parser): IrAction {
    return parseActionRecovering(p, 'CONDITIONAL', (action) => {
        action.matchAny = p.spanned(() => {
            if (p.eatIdent('and') || p.eatIdent('false')) return false;
            else if (p.eatIdent('or') || p.eatIdent('true')) return true;
            else if (p.check('ident'))
                throw error('Expected conditional mode', p.token.span);
            else return false; // not null because :(
        });

        action.conditions = p.spanned(() => {
            return p
                .parseDelimitedCommaSeq('parenthesis', () => {
                    return p.parseRecovering(
                        ['comma', { kind: 'close_delim', delim: 'parenthesis' }],
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
        let hadNewline = p.eat('eol');

        if (p.eatIdent('else')) {
            action.elseActions = p.spanned(p.parseBlock);
        } else if (hadNewline) {
            p.tokens.push(p.token);
            p.token = token;
        }
    });
}

function parseActionDisplayMenu(p: Parser): IrAction {
    return parseActionRecovering(p, 'SET_MENU', (action) => {
        action.menu = p.spanned(p.parseName);
    });
}

function parseActionDropItem(p: Parser): IrAction {
    return parseActionRecovering(p, 'DROP_ITEM', (action) => {
        action.item = p.spanned(p.parseName);
        action.location = p.spanned(parseLocation);
        action.dropNaturally = p.spanned(p.parseBoolean);
        action.disableMerging = p.spanned(p.parseBoolean);
        action.prioritizePlayer = p.spanned(p.parseBoolean);
        action.inventoryFallback = p.spanned(p.parseBoolean);
    });
}

function parseActionEnchantHeldItem(p: Parser): IrAction {
    return parseActionRecovering(p, 'ENCHANT_HELD_ITEM', (action) => {
        action.enchant = p.spanned(parseEnchantment);
        action.level = p.spanned(() => p.parseBoundedNumber(1, 10));
    });
}

function parseActionFailParkour(p: Parser): IrAction {
    return parseActionRecovering(p, 'FAIL_PARKOUR', (action) => {
        action.message = p.spanned(p.parseString);
    });
}

function parseActionFunction(p: Parser): IrAction {
    return parseActionRecovering(p, 'FUNCTION', (action) => {
        action.function = p.spanned(p.parseName);
        if (p.checkEol()) return; // shorthand
        action.global = p.spanned(p.parseBoolean);
    });
}

function parseActionGiveExperienceLevels(p: Parser): IrAction {
    return parseActionRecovering(p, 'GIVE_EXPERIENCE_LEVELS', (action) => {
        action.amount = p.spanned(parseNumericValue);
    });
}

function parseActionGiveItem(p: Parser): IrAction {
    return parseActionRecovering(p, 'GIVE_ITEM', (action) => {
        action.item = p.spanned(p.parseName);
        action.allowMultiple = p.spanned(p.parseBoolean);
        action.slot = p.spanned(parseInventorySlot);
        action.replaceExisting = p.spanned(p.parseBoolean);
    });
}

function parseActionLaunch(p: Parser): IrAction {
    return parseActionRecovering(p, 'LAUNCH', (action) => {
        action.location = p.spanned(parseLocation);
        action.strength = p.spanned(() => p.parseBoundedNumber(1, 10));
    });
}

function parseActionMessage(p: Parser): IrAction {
    return parseActionRecovering(p, 'MESSAGE', (action) => {
        action.message = p.spanned(p.parseString);
    });
}

function parseActionPause(p: Parser): IrAction {
    return parseActionRecovering(p, 'PAUSE', (action) => {
        action.ticks = p.spanned(() => p.parseBoundedNumber(1, 1000));
    });
}

function parseActionPlaySound(p: Parser): IrAction {
    return parseActionRecovering(p, 'PLAY_SOUND', (action) => {
        action.sound = p.spanned(parseSound);
        action.volume = p.spanned(p.parseFloat);
        action.pitch = p.spanned(p.parseFloat);
        action.location = p.spanned(parseLocation);
    });
}

function parseActionRandom(p: Parser): IrAction {
    return parseActionRecovering(p, 'RANDOM', (action) => {
        action.actions = p.spanned(p.parseBlock);
    });
}

function parseActionRecovering<T extends IrAction['type']>(
    p: Parser,
    type: T,
    parser: (action: IrAction & { type: T }) => void
): IrAction & { type: T } {
    const start = p.prev.span.start;
    const action = {
        type,
        kwSpan: p.prev.span,
        span: Span.single(-1) // placeholder
    } as IrAction & { type: T };
    p.parseRecovering(['eol'], () => {
        parser(action);
    });
    action.span = new Span(start, p.prev.span.end);
    return action;
}

function parseActionRemoveItem(p: Parser): IrAction {
    return parseActionRecovering(p, 'REMOVE_ITEM', (action) => {
        action.item = p.spanned(p.parseName);
    });
}

function parseActionSendToLobby(p: Parser): IrAction {
    return parseActionRecovering(p, 'SEND_TO_LOBBY', (action) => {
        action.lobby = p.spanned(parseLobby);
    });
}

function parseActionSetCompassTarget(p: Parser): IrAction {
    return parseActionRecovering(p, 'SET_COMPASS_TARGET', (action) => {
        action.location = p.spanned(parseLocation);
    });
}

function parseActionSetGamemode(p: Parser): IrAction {
    return parseActionRecovering(p, 'SET_GAMEMODE', (action) => {
        action.gamemode = p.spanned(parseGamemode);
    });
}

function parseActionSetGroup(p: Parser): IrAction {
    return parseActionRecovering(p, 'SET_GROUP', (action) => {
        action.group = p.spanned(p.parseString);
        if (p.checkEol()) return;
        action.demotionProtection = p.spanned(p.parseBoolean);
    });
}

function parseActionSetTeam(p: Parser): IrAction {
    return parseActionRecovering(p, 'SET_TEAM', (action) => {
        action.team = p.spanned(p.parseName);
    });
}

function parseActionSetVelocity(p: Parser): IrAction {
    return parseActionRecovering(p, 'SET_VELOCITY', (action) => {
        action.x = p.spanned(parseNumericValue);
        action.y = p.spanned(parseNumericValue);
        action.z = p.spanned(parseNumericValue);
    });
}

function parseActionTeleport(p: Parser): IrAction {
    return parseActionRecovering(p, 'TELEPORT', (action) => {
        action.location = p.spanned(parseLocation);
    });
}

function parseActionTitle(p: Parser): IrAction {
    return parseActionRecovering(p, 'TITLE', (action) => {
        action.title = p.spanned(p.parseString);
        if (p.checkEol()) return; // shorthand
        action.subtitle = p.spanned(p.parseString);
        if (p.checkEol()) return; // shorthand

        action.fadein = p.spanned(() => p.parseBoundedNumber(0, 5));
        action.stay = p.spanned(() => p.parseBoundedNumber(0, 10));
        action.fadeout = p.spanned(() => p.parseBoundedNumber(0, 5));
    });
}