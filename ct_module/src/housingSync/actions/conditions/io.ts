import type { Condition } from "htsw/types";

import TaskContext from "../../../tasks/context";
import type { ResolveItemField } from "../../items/itemReferences";
import { ItemSlot } from "../../../tasks/specifics/slots";
import { removedFormatting } from "../../../utils/helpers";
import { CONDITION_MAPPINGS } from "../../fields/conditionMappings";
import { conditionOnlyNoteDiffers } from "../comparison";
import {
    readRequireGroup,
    writeRequireGroup,
    writeCompareVar,
    writeRequirePermission,
    writeIsInRegion,
    writeRequireItem,
    writeRequirePotionEffect,
    writeCompareHealth,
    writeCompareMaxHealth,
    writeCompareHunger,
    writeRequireGamemode,
    writeComparePlaceholder,
    writeRequireTeam,
    writeDamageCause,
    writeFishingEnvironment,
    writePortalType,
    writeBlockType,
    writeIsItem,
    writeCompareDamage,
} from "./writers";

export type ConditionIo<T extends Condition> = {
    displayName: string;
    read?: (ctx: TaskContext) => Promise<T>;
    write?: (
        ctx: TaskContext,
        desired: T,
        current: T | undefined,
        resolveItem: ResolveItemField
    ) => Promise<void>;
};

type ConditionIoMap = {
    [K in Condition["type"]]: ConditionIo<Extract<Condition, { type: K }>>;
};

export function getConditionIo<T extends Condition["type"]>(
    type: T
): ConditionIo<Extract<Condition, { type: T }>> {
    return CONDITION_IO[type] as ConditionIo<Extract<Condition, { type: T }>>;
}

export function isConditionListItemInverted(slot: ItemSlot): boolean {
    return slot
        .getItem()
        .getLore()
        .some((line) => removedFormatting(line).trim() === "Inverted");
}

const CONDITION_IO = {
    REQUIRE_GROUP: {
        displayName: CONDITION_MAPPINGS.REQUIRE_GROUP.displayName,
        read: readRequireGroup,
        write: writeRequireGroup,
    },
    COMPARE_VAR: {
        displayName: CONDITION_MAPPINGS.COMPARE_VAR.displayName,
        write: writeCompareVar,
    },
    REQUIRE_PERMISSION: {
        displayName: CONDITION_MAPPINGS.REQUIRE_PERMISSION.displayName,
        write: writeRequirePermission,
    },
    IS_IN_REGION: {
        displayName: CONDITION_MAPPINGS.IS_IN_REGION.displayName,
        write: writeIsInRegion,
    },
    REQUIRE_ITEM: {
        displayName: CONDITION_MAPPINGS.REQUIRE_ITEM.displayName,
        write: writeRequireItem,
    },
    IS_DOING_PARKOUR: {
        displayName: CONDITION_MAPPINGS.IS_DOING_PARKOUR.displayName,
    },
    REQUIRE_POTION_EFFECT: {
        displayName: CONDITION_MAPPINGS.REQUIRE_POTION_EFFECT.displayName,
        write: writeRequirePotionEffect,
    },
    IS_SNEAKING: {
        displayName: CONDITION_MAPPINGS.IS_SNEAKING.displayName,
    },
    IS_FLYING: {
        displayName: CONDITION_MAPPINGS.IS_FLYING.displayName,
    },
    COMPARE_HEALTH: {
        displayName: CONDITION_MAPPINGS.COMPARE_HEALTH.displayName,
        write: writeCompareHealth,
    },
    COMPARE_MAX_HEALTH: {
        displayName: CONDITION_MAPPINGS.COMPARE_MAX_HEALTH.displayName,
        write: writeCompareMaxHealth,
    },
    COMPARE_HUNGER: {
        displayName: CONDITION_MAPPINGS.COMPARE_HUNGER.displayName,
        write: writeCompareHunger,
    },
    REQUIRE_GAMEMODE: {
        displayName: CONDITION_MAPPINGS.REQUIRE_GAMEMODE.displayName,
        write: writeRequireGamemode,
    },
    COMPARE_PLACEHOLDER: {
        displayName: CONDITION_MAPPINGS.COMPARE_PLACEHOLDER.displayName,
        write: writeComparePlaceholder,
    },
    REQUIRE_TEAM: {
        displayName: CONDITION_MAPPINGS.REQUIRE_TEAM.displayName,
        write: writeRequireTeam,
    },
    DAMAGE_CAUSE: {
        displayName: CONDITION_MAPPINGS.DAMAGE_CAUSE.displayName,
        write: writeDamageCause,
    },
    PVP_ENABLED: {
        displayName: CONDITION_MAPPINGS.PVP_ENABLED.displayName,
    },
    FISHING_ENVIRONMENT: {
        displayName: CONDITION_MAPPINGS.FISHING_ENVIRONMENT.displayName,
        write: writeFishingEnvironment,
    },
    PORTAL_TYPE: {
        displayName: CONDITION_MAPPINGS.PORTAL_TYPE.displayName,
        write: writePortalType,
    },
    BLOCK_TYPE: {
        displayName: CONDITION_MAPPINGS.BLOCK_TYPE.displayName,
        write: writeBlockType,
    },
    IS_ITEM: {
        displayName: CONDITION_MAPPINGS.IS_ITEM.displayName,
        write: writeIsItem,
    },
    COMPARE_DAMAGE: {
        displayName: CONDITION_MAPPINGS.COMPARE_DAMAGE.displayName,
        write: writeCompareDamage,
    },
} satisfies ConditionIoMap;

export async function writeOpenCondition(
    ctx: TaskContext,
    condition: Condition,
    current: Condition | undefined,
    resolveItem: ResolveItemField
): Promise<void> {
    if (current && conditionOnlyNoteDiffers(condition, current)) {
        return;
    }

    const spec = getConditionIo(condition.type);
    let resolvedCurrent = current;

    if (resolvedCurrent === undefined && spec.read) {
        resolvedCurrent = await spec.read(ctx);
    }

    if (spec.write) {
        await spec.write(ctx, condition, resolvedCurrent, resolveItem);
    }
}
