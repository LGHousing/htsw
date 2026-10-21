import { enterValue } from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import type TaskContext from "../../tasks/context";
import type { ItemSlot } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { openTeamsList } from "./listTeams";
import {
    CHANGE_COLOR_SLOT,
    CHANGE_TAG_SLOT,
    readColorValue,
    readEnabledDisabled,
    readLabeledLoreValue,
    readTagValue,
} from "../teamGroupMenus";

const FRIENDLY_FIRE_SLOT = "Friendly Fire";

const CURRENT_VALUE_LABEL = "Current Value:";

export type TeamSettings = {
    tag: string | null;
    color: string | null;
    friendlyFire: boolean | null;
};

function readFriendlyFireValue(slot: ItemSlot): boolean | null {
    return readEnabledDisabled(readLabeledLoreValue(slot, CURRENT_VALUE_LABEL));
}

export async function createTeam(ctx: TaskContext, name: string): Promise<void> {
    await openTeamsList(ctx);
    ctx.getMenuItemSlot("Create Team").click();
    await enterValue(ctx, name, "Team name");
}

export function readTeamSettings(ctx: TaskContext): TeamSettings {
    const tagSlot = ctx.tryGetMenuItemSlot(CHANGE_TAG_SLOT);
    const colorSlot = ctx.tryGetMenuItemSlot(CHANGE_COLOR_SLOT);
    const fireSlot = ctx.tryGetMenuItemSlot(FRIENDLY_FIRE_SLOT);
    return {
        tag: tagSlot === null ? null : readTagValue(tagSlot),
        color: colorSlot === null ? null : readColorValue(colorSlot),
        friendlyFire: fireSlot === null ? null : readFriendlyFireValue(fireSlot),
    };
}

export async function setTeamTag(ctx: TaskContext, tag: string): Promise<void> {
    const slot = ctx.getMenuItemSlot(CHANGE_TAG_SLOT);
    if (readTagValue(slot) === tag) return;
    slot.click();
    await enterValue(ctx, tag, "Team tag", undefined, {
        read: () => {
            const fresh = ctx.tryGetMenuItemSlot(CHANGE_TAG_SLOT);
            return fresh === null ? null : readTagValue(fresh);
        },
        matches: (actual, expected) => actual === removedFormatting(expected),
    });
}

export async function setTeamFriendlyFire(
    ctx: TaskContext,
    value: boolean
): Promise<void> {
    const slot = ctx.getMenuItemSlot(FRIENDLY_FIRE_SLOT);
    if (readFriendlyFireValue(slot) === value) return;
    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    const updated = readFriendlyFireValue(ctx.getMenuItemSlot(FRIENDLY_FIRE_SLOT));
    if (updated !== null && updated !== value) {
        throw new Error(
            `Failed to set team friendly fire to ${value ? "Enabled" : "Disabled"}.`
        );
    }
}
