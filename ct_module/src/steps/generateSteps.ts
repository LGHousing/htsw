import type { ActionHolder, Action } from 'housing-common/src/types';
import { Step } from './step';
import {
    booleanAsValue,
    numberAsValue,
    stringAsValue,
    stepsAddAction,
    stepGoBack,
    stepClickButtonOrNextPage,
    stepsClickButtonThenSelectValue,
} from './helpers';
import { chatHistoryContains, normalized } from '../utils';
import { Importer } from '../importer/importer';

function stepsFromAction(action: Action): Step[] {
    switch (action.type) {
        case 'CONDITIONAL':
            const steps = stepsAddAction('conditional');
            return steps;
        case 'SET_GROUP':
            return [
                ...stepsAddAction('change_players_group'),
                ...stepsClickButtonThenSelectValue(
                    'group',
                    true,
                    stringAsValue(action.group),
                    false
                ),
                ...stepsClickButtonThenSelectValue(
                    'demotion_protection',
                    true,
                    booleanAsValue(action.demotionProtection),
                    false
                ),
                stepGoBack(),
            ];
        case 'KILL':
            return [];
        case 'HEAL':
            return [];
        case 'TITLE':
            return [
                ...stepsAddAction('display_title'),
                ...stepsClickButtonThenSelectValue(
                    'title',
                    true,
                    stringAsValue(action.title),
                    false
                ),
                ...stepsClickButtonThenSelectValue(
                    'subtitle',
                    true,
                    stringAsValue(action.subtitle),
                    false
                ),
                ...stepsClickButtonThenSelectValue(
                    'fadein',
                    true,
                    numberAsValue(action.fadein),
                    false
                ),
                ...stepsClickButtonThenSelectValue(
                    'stay',
                    true,
                    numberAsValue(action.stay),
                    false
                ),
                ...stepsClickButtonThenSelectValue(
                    'fadeout',
                    true,
                    numberAsValue(action.fadeout),
                    false
                ),
                stepGoBack(),
            ];
        case 'ACTION_BAR':
            return [];
        case 'RESET_INVENTORY':
            return [];
        case 'CHANGE_MAX_HEALTH':
            return [];
        case 'GIVE_ITEM':
            return [];
        case 'REMOVE_ITEM':
            return [];
        case 'MESSAGE':
            return [];
        case 'APPLY_POTION_EFFECT':
            return [];
        case 'CLEAR_POTION_EFFECTS':
            return [];
        case 'GIVE_EXPERIENCE_LEVELS':
            return [];
        case 'SEND_TO_LOBBY':
            return [];
        case 'CHANGE_STAT':
            return [];
        case 'CHANGE_GLOBAL_STAT':
            return [];
        case 'TELEPORT':
            return [];
        case 'FAIL_PARKOUR':
            return [];
        case 'PLAY_SOUND':
            return [];
        case 'SET_COMPASS_TARGET':
            return [];
        case 'SET_GAMEMODE':
            return [];
        case 'CHANGE_HEALTH':
            return [];
        case 'CHANGE_HUNGER':
            return [];
        case 'RANDOM':
            return [];
        case 'FUNCTION':
            return [];
        case 'APPLY_INVENTORY_LAYOUT':
            return [];
        case 'ENCHANT_HELD_ITEM':
            return [];
        case 'PAUSE':
            return [];
        case 'SET_TEAM':
            return [];
        case 'CHANGE_TEAM_STAT':
            return [];
        case 'SET_MENU':
            return [];
        case 'DROP_ITEM':
            return [];
        case 'SET_VELOCITY':
            return [];
        case 'LAUNCH':
            return [];
        case 'EXIT':
            return [];
        case 'CANCEL_EVENT':
            return [];
        default:
            // @ts-ignore
            throw new Error(`Unknown action type: ${action.type}`);
    }
}

function stepsFromActions(actions: Action[]): Step[] {
    let steps: Step[] = [];
    for (const action of actions) {
        const actionSteps = stepsFromAction(action);
        steps = [...steps, ...actionSteps];
    }
    return steps;
}

function stepsFromHolder(holder: ActionHolder): Step[] {
    let steps: Step[];
    switch (holder.type) {
        case 'FUNCTION':
            steps = [
                {
                    type: 'RUN_COMMAND',
                    command: `/function edit ${holder.name}`,
                },
                {
                    type: 'CONDITIONAL',
                    condition: () => {
                        const importer = Importer.INSTANCE;
                        if (!importer) {
                            throw new Error(
                                'Importer is not initialized, this should not happen'
                            );
                        }
                        return chatHistoryContains(
                            'Could not find a function with that name!',
                            importer.getLastStepExecutedAt(),
                            false,
                            false
                        );
                    },
                    then: () => [
                        {
                            type: 'RUN_COMMAND',
                            command: `/function create ${holder.name}`,
                        },
                    ],
                    else: () => [],
                },
            ];
            break;
        case 'EVENT':
            steps = [
                {
                    type: 'RUN_COMMAND',
                    command: `/eventactions`,
                },
                stepClickButtonOrNextPage(normalized(holder.event), true),
            ];
            break;
        case 'UNKNOWN':
            steps = [];
            break;
        default:
            // @ts-ignore
            throw new Error(`Unknown holder type: ${holder.type}`);
    }
    for (const step of stepsFromActions(holder.actions)) {
        steps.push(step);
    }
    return steps;
}

export function generateSteps(holders: ActionHolder[]): Step[] {
    let steps: Step[] = [];
    for (const holder of holders) {
        const holderSteps = stepsFromHolder(holder);
        steps = [...steps, ...holderSteps];
    }
    return steps;
}
