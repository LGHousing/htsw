import type { Action, actions } from 'housing-common';
import { nullableFn, type ActionKw } from '../helpers';
import { generateBlock, generateConditions, generateOperation, generateString, generateValue } from './arguments';

export function generateAction(action: Action): string {
    switch (action.type) {
        case 'ACTION_BAR': return generateActionActionBar(action);
        case 'APPLY_INVENTORY_LAYOUT': return generateActionApplyInventoryLayout(action);
        case 'APPLY_POTION_EFFECT': return generateActionApplyPotionEffect(action);
        case 'CANCEL_EVENT': return 'cancelEvent';
        case 'CHANGE_HEALTH': return generateActionChangeHealth(action);
        case 'CHANGE_VAR': return generateActionChangeVar(action);
        case 'CLEAR_POTION_EFFECTS': return 'clearEffects';
        case 'CONDITIONAL': return generateActionConditional(action);
        case 'DROP_ITEM': return generateActionDropItem(action);
        case 'ENCHANT_HELD_ITEM': return generateActionEnchantHeldItem(action);
        case 'EXIT': return 'exit';
        case 'FAIL_PARKOUR': return generateActionFailParkour(action);
        case 'FUNCTION': return generateActionFunction(action);
        case 'GIVE_EXPERIENCE_LEVELS': return generateActionGiveExperienceLevels(action);
        case 'GIVE_ITEM': return generateActionGiveItem(action);
        case 'HEAL': return 'fullHeal';
        case 'KILL': return 'kill';
        case 'LAUNCH': return generateActionLaunch(action);
        case 'MESSAGE': return generateActionMessage(action);
        case 'PAUSE': return generateActionPause(action);
        case 'PLAY_SOUND': return generateActionPlaySound(action);
        case 'RANDOM': return generateActionRandom(action);
        case 'REMOVE_ITEM': return generateActionRemoveItem(action);
        case 'RESET_INVENTORY': return 'resetInventory';
        case 'SEND_TO_LOBBY': return generateActionSendToLobby(action);
        case 'SET_COMPASS_TARGET': return generateActionSetCompassTarget(action);
        case 'SET_GAMEMODE': return generateActionSetGamemode(action);
        case 'SET_GROUP': return generateActionSetGroup(action);
        case 'SET_MENU': return generateActionDisplayMenu(action);
        case 'SET_TEAM': return generateActionSetTeam(action);
        case 'SET_VELOCITY': return generateActionSetVelocity(action);
        case 'TELEPORT': return generateActionTeleport(action);
        case 'TITLE': return generateActionTitle(action);
        default: return `// Unknown action: ${action.type};`
    }
}

function generateActionJoining(kw: ActionKw, ...parts: any): string {
    return [kw, ...parts].filter((it: any) => it !== undefined).join(" ");
}

function generateActionActionBar(action: actions.ActionActionBar): string {
    return generateActionJoining(
        "actionBar",
        nullableFn(generateString)(action.message),
    );
}

function generateActionApplyInventoryLayout(action: actions.ActionApplyInventoryLayout): string {
    return generateActionJoining(
        "applyLayout",
        nullableFn(generateString)(action.layout),
    );
}

function generateActionApplyPotionEffect(
    action: actions.ActionApplyPotionEffect
): string {
    return generateActionJoining(
        "applyPotion",
        action.effect,
        action.duration,
        action.level,
        action.override,
        action.showIcon,
    );
}

function generateActionChangeHealth(
    action: actions.ActionChangeHealth
): string {
    return generateActionJoining(
        "changeHealth",
        nullableFn(generateOperation)(action.op),
        nullableFn(generateValue)(action.amount),
    );
}

function generateActionChangeVar(action: actions.ActionChangeVar): string {
    let kw: ActionKw;
    switch (action.holder?.type ?? "player") {
        case 'player': { kw = "var"; break; }
        case 'global': { kw = "globalvar"; break; }
        case 'team': { kw = "teamvar"; break; }
    }

    return generateActionJoining(
        kw,
        action.var,
        nullableFn(generateOperation)(action.op),
        nullableFn(generateValue)(action.value),
        action.unset,
    );
}

function generateActionConditional(action: actions.ActionConditional): string {
    return generateActionJoining(
        "if",
        action.matchAny === true ? "or" : undefined,
        generateConditions(action.conditions ?? []),
        nullableFn(generateBlock)(action.ifActions) ?? "{}",
        (action.elseActions?.length ?? 0) > 0 
            ? generateBlock(action.elseActions!)
            : undefined
    );
}

function generateActionDisplayMenu(action: actions.ActionDisplayMenu): string {
    return generateActionJoining(
        "displayMenu",
        action.menu
    );
}

function generateActionDropItem(action: actions.ActionDropItem): string {
    return generateActionJoining(
        "dropItem",
        action.item,
        action.location,
        action.dropNaturally,
        action.disableMerging,
        action.prioritizePlayer,
        action.inventoryFallback,
    );
}

function generateActionEnchantHeldItem(action: actions.ActionEnchantHeldItem): string {
    return generateActionJoining(
        "enchant",
        action.enchant,
        action.level,
    );
}

function generateActionFailParkour(action: actions.ActionFailParkour): string {
    return generateActionJoining(
        "failParkour",
        nullableFn(generateString)(action.message),
    );
}

function generateActionFunction(action: actions.ActionFunction): string {
    return generateActionJoining(
        "function",
        action.function,
        action.global,
    );
}

function generateActionGiveExperienceLevels(action: actions.ActionGiveExperienceLevels): string {
    return generateActionJoining(
        "xpLevel",
        nullableFn(generateValue)(action.amount)
    );
}

function generateActionGiveItem(action: actions.ActionGiveItem): string {
    return generateActionJoining(
        "giveItem",
        action.item,
        action.allowMultiple,
        action.slot,
        action.replaceExisting,
    );
}

function generateActionLaunch(action: actions.ActionLaunch): string {
    return generateActionJoining(
        "launch",
        action.location,
        action.strength,
    );
}

function generateActionMessage(action: actions.ActionMessage): string {
    return generateActionJoining(
        "chat",
        nullableFn(generateString)(action.message),
    );
}

function generateActionPause(action: actions.ActionPauseExecution): string {
    return generateActionJoining(
        "pause",
        action.ticks,
    );
}

function generateActionPlaySound(action: actions.ActionPlaySound): string {
    return generateActionJoining(
        "sound",
        action.sound,
        action.volume,
        action.pitch,
        action.location,
    );
}

function generateActionRandom(action: actions.ActionRandom): string {
    return generateActionJoining(
        "random",
        nullableFn(generateBlock)(action.actions),
    );
}

function generateActionRemoveItem(action: actions.ActionRemoveItem): string {
    return generateActionJoining(
        "removeItem",
        action.item
    );
}

function generateActionSendToLobby(action: actions.ActionSendToLobby): string {
    return generateActionJoining(
        "lobby",
        nullableFn(generateString)(action.lobby)
    );
}

function generateActionSetCompassTarget(action: actions.ActionSetCompassTarget): string {
    return generateActionJoining(
        "compassTarget",
        action.location
    );
}

function generateActionSetGamemode(action: actions.ActionSetGamemode): string {
    return generateActionJoining(
        "gamemode",
        action.gamemode
    );
}

function generateActionSetGroup(action: actions.ActionSetGroup): string {
    return generateActionJoining(
        "changePlayerGroup",
        nullableFn(generateString)(action.group),
        action.demotionProtection
    );
}

function generateActionSetTeam(action: actions.ActionSetTeam): string {
    return generateActionJoining(
        "setTeam",
        nullableFn(generateString)(action.team)
    );
}

function generateActionSetVelocity(action: actions.ActionSetVelocity): string {
    return generateActionJoining(
        "changeVelocity",
        nullableFn(generateValue)(action.x),
        nullableFn(generateValue)(action.y),
        nullableFn(generateValue)(action.z)
    );
}

function generateActionTeleport(action: actions.ActionTeleport): string {
    return generateActionJoining(
        "tp",
        action.location
    );
}

function generateActionTitle(action: actions.ActionTitle): string {
    return generateActionJoining(
        "title",
        nullableFn(generateString)(action.title),
        nullableFn(generateString)(action.subtitle),
        action.fadein,
        action.stay,
        action.fadeout,
    );
}