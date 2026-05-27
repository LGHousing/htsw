import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import { ACTION_MAPPINGS } from "../fields/actionMappings";
import type {
    NestedPropsToRead,
    Observed,
    ListReadOptions,
} from "../types";
import type { ActionPath, ImportEventHandler, ProgressScope } from "../importEvents";
import {
    readOpenConditional,
    readOpenTitle,
    readOpenActionBar,
    readOpenTeleport,
    readOpenFailParkour,
    readOpenPlaySound,
    readOpenSetCompassTarget,
    readOpenRandom,
    readOpenFunction,
    readOpenApplyInventoryLayout,
    readOpenSetMenu,
    readOpenDropItem,
    readOpenLaunch,
    readOpenMessage,
} from "./readers";
import {
    writeConditional,
    writeSetGroup,
    writeTitle,
    writeActionBar,
    writeChangeMaxHealth,
    writeGiveItem,
    writeRemoveItem,
    writeSendMessage,
    writeApplyPotionEffect,
    writeGiveExperienceLevels,
    writeSendToLobby,
    writeChangeVar,
    writeTeleport,
    writeFailParkour,
    writePlaySound,
    writeSetCompassTarget,
    writeSetGamemode,
    writeChangeHealth,
    writeChangeHunger,
    writeRandom,
    writeFunction,
    writeApplyInventoryLayout,
    writeEnchantHeldItem,
    writePause,
    writeSetTeam,
    writeDisplayMenu,
    writeDropItem,
    writeSetVelocity,
    writeLaunch,
    writeSetPlayerWeather,
    writeSetPlayerTime,
    writeToggleNametagDisplay,
} from "./writers";

export type WriteActionOptions<T extends Action = Action> = {
    current?: Observed<T>;
    itemRegistry?: ItemRegistry;
    pathPrefix?: ActionPath;
    nestedProgressScope?: (path: ActionPath) => ProgressScope | undefined;
    events?: ImportEventHandler;
};

export type ActionReadArgs<T extends Action> = {
    ctx: TaskContext;
    propsToRead: NestedPropsToRead;
    read?: ListReadOptions;
    current?: Observed<T>;
};

type ActionSpec<T extends Action = Action> = {
    displayName: string;
    read?: (args: ActionReadArgs<T>) => Promise<Observed<T>>;
    write?: (
        ctx: TaskContext,
        desired: T,
        options?: WriteActionOptions<T>
    ) => Promise<void>;
};

export function actionPathForIndex(pathPrefix: string | undefined, index: number): ActionPath {
    return pathPrefix && pathPrefix.length > 0
        ? `${pathPrefix}.${index}`
        : String(index);
}

type ActionSpecMap = {
    [K in Action["type"]]: ActionSpec<Extract<Action, { type: K }>>;
};

export function getActionSpec<T extends Action["type"]>(
    type: T
): ActionSpec<Extract<Action, { type: T }>> {
    return ACTION_SPECS[type] as ActionSpec<Extract<Action, { type: T }>>;
}

const ACTION_SPECS = {
    CONDITIONAL: {
        displayName: ACTION_MAPPINGS.CONDITIONAL.displayName,
        read: readOpenConditional,
        write: writeConditional,
    },
    SET_GROUP: {
        displayName: ACTION_MAPPINGS.SET_GROUP.displayName,
        write: writeSetGroup,
    },
    KILL: {
        displayName: ACTION_MAPPINGS.KILL.displayName,
    },
    HEAL: {
        displayName: ACTION_MAPPINGS.HEAL.displayName,
    },
    TITLE: {
        displayName: ACTION_MAPPINGS.TITLE.displayName,
        read: readOpenTitle,
        write: writeTitle,
    },
    ACTION_BAR: {
        displayName: ACTION_MAPPINGS.ACTION_BAR.displayName,
        read: readOpenActionBar,
        write: writeActionBar,
    },
    RESET_INVENTORY: {
        displayName: ACTION_MAPPINGS.RESET_INVENTORY.displayName,
    },
    CHANGE_MAX_HEALTH: {
        displayName: ACTION_MAPPINGS.CHANGE_MAX_HEALTH.displayName,
        write: writeChangeMaxHealth,
    },
    PARKOUR_CHECKPOINT: {
        displayName: ACTION_MAPPINGS.PARKOUR_CHECKPOINT.displayName,
    },
    GIVE_ITEM: {
        displayName: ACTION_MAPPINGS.GIVE_ITEM.displayName,
        write: writeGiveItem,
    },
    REMOVE_ITEM: {
        displayName: ACTION_MAPPINGS.REMOVE_ITEM.displayName,
        write: writeRemoveItem,
    },
    MESSAGE: {
        displayName: ACTION_MAPPINGS.MESSAGE.displayName,
        read: readOpenMessage,
        write: writeSendMessage,
    },
    APPLY_POTION_EFFECT: {
        displayName: ACTION_MAPPINGS.APPLY_POTION_EFFECT.displayName,
        write: writeApplyPotionEffect,
    },
    CLEAR_POTION_EFFECTS: {
        displayName: ACTION_MAPPINGS.CLEAR_POTION_EFFECTS.displayName,
    },
    GIVE_EXPERIENCE_LEVELS: {
        displayName: ACTION_MAPPINGS.GIVE_EXPERIENCE_LEVELS.displayName,
        write: writeGiveExperienceLevels,
    },
    SEND_TO_LOBBY: {
        displayName: ACTION_MAPPINGS.SEND_TO_LOBBY.displayName,
        write: writeSendToLobby,
    },
    CHANGE_VAR: {
        displayName: ACTION_MAPPINGS.CHANGE_VAR.displayName,
        write: writeChangeVar,
    },
    TELEPORT: {
        displayName: ACTION_MAPPINGS.TELEPORT.displayName,
        read: readOpenTeleport,
        write: writeTeleport,
    },
    FAIL_PARKOUR: {
        displayName: ACTION_MAPPINGS.FAIL_PARKOUR.displayName,
        read: readOpenFailParkour,
        write: writeFailParkour,
    },
    PLAY_SOUND: {
        displayName: ACTION_MAPPINGS.PLAY_SOUND.displayName,
        read: readOpenPlaySound,
        write: writePlaySound,
    },
    SET_COMPASS_TARGET: {
        displayName: ACTION_MAPPINGS.SET_COMPASS_TARGET.displayName,
        read: readOpenSetCompassTarget,
        write: writeSetCompassTarget,
    },
    SET_GAMEMODE: {
        displayName: ACTION_MAPPINGS.SET_GAMEMODE.displayName,
        write: writeSetGamemode,
    },
    CHANGE_HEALTH: {
        displayName: ACTION_MAPPINGS.CHANGE_HEALTH.displayName,
        write: writeChangeHealth,
    },
    CHANGE_HUNGER: {
        displayName: ACTION_MAPPINGS.CHANGE_HUNGER.displayName,
        write: writeChangeHunger,
    },
    RANDOM: {
        displayName: ACTION_MAPPINGS.RANDOM.displayName,
        read: readOpenRandom,
        write: writeRandom,
    },
    FUNCTION: {
        displayName: ACTION_MAPPINGS.FUNCTION.displayName,
        read: readOpenFunction,
        write: writeFunction,
    },
    APPLY_INVENTORY_LAYOUT: {
        displayName: ACTION_MAPPINGS.APPLY_INVENTORY_LAYOUT.displayName,
        read: readOpenApplyInventoryLayout,
        write: writeApplyInventoryLayout,
    },
    ENCHANT_HELD_ITEM: {
        displayName: ACTION_MAPPINGS.ENCHANT_HELD_ITEM.displayName,
        write: writeEnchantHeldItem,
    },
    PAUSE: {
        displayName: ACTION_MAPPINGS.PAUSE.displayName,
        write: writePause,
    },
    SET_TEAM: {
        displayName: ACTION_MAPPINGS.SET_TEAM.displayName,
        write: writeSetTeam,
    },
    SET_MENU: {
        displayName: ACTION_MAPPINGS.SET_MENU.displayName,
        read: readOpenSetMenu,
        write: writeDisplayMenu,
    },
    CLOSE_MENU: {
        displayName: ACTION_MAPPINGS.CLOSE_MENU.displayName,
    },
    DROP_ITEM: {
        displayName: ACTION_MAPPINGS.DROP_ITEM.displayName,
        read: readOpenDropItem,
        write: writeDropItem,
    },
    SET_VELOCITY: {
        displayName: ACTION_MAPPINGS.SET_VELOCITY.displayName,
        write: writeSetVelocity,
    },
    LAUNCH: {
        displayName: ACTION_MAPPINGS.LAUNCH.displayName,
        read: readOpenLaunch,
        write: writeLaunch,
    },
    SET_PLAYER_WEATHER: {
        displayName: ACTION_MAPPINGS.SET_PLAYER_WEATHER.displayName,
        write: writeSetPlayerWeather,
    },
    SET_PLAYER_TIME: {
        displayName: ACTION_MAPPINGS.SET_PLAYER_TIME.displayName,
        write: writeSetPlayerTime,
    },
    TOGGLE_NAMETAG_DISPLAY: {
        displayName: ACTION_MAPPINGS.TOGGLE_NAMETAG_DISPLAY.displayName,
        write: writeToggleNametagDisplay,
    },
    USE_HELD_ITEM: {
        displayName: ACTION_MAPPINGS.USE_HELD_ITEM.displayName,
    },
    EXIT: {
        displayName: ACTION_MAPPINGS.EXIT.displayName,
    },
    CANCEL_EVENT: {
        displayName: ACTION_MAPPINGS.CANCEL_EVENT.displayName,
    },
} satisfies ActionSpecMap;

export async function writeOpenAction(
    ctx: TaskContext,
    desired: Action,
    opts?: WriteActionOptions<Action>
): Promise<void> {
    const spec = getActionSpec(desired.type);
    let resolvedCurrent = opts?.current;

    if (resolvedCurrent === undefined && spec.read) {
        resolvedCurrent = await spec.read({
            ctx,
            propsToRead: new Set(),
            read: {
                itemRegistry: opts?.itemRegistry,
                pathPrefix: opts?.pathPrefix,
                events: opts?.events,
            },
            current: opts?.current,
        });
    }

    if (!spec.write) {
        throw new Error(`Writing action "${desired.type}" is not implemented.`);
    }

    await spec.write(ctx, desired, {
        ...opts,
        current: resolvedCurrent,
    });
}
