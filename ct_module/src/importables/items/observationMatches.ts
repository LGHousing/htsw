import * as htsw from "htsw";
import type { Action, Condition } from "htsw/types";

import type { ItemDependencyIndex } from "./dependencyIndex";
import type { ProjectItem } from "./projectItems";
import type { ItemFieldObservationRecorder } from "../../housingSync/items/fieldObservations";
import { canonicalItemShellTagKey } from "../../housingSync/items/itemNbt";
import { tagChild, type TagLike } from "../../housingSync/items/itemTag";
import { expectedInteractData } from "./interactDataCache";

export const MISSING_FIELD_INTERACT_DATA_WARNING =
    "⚠ field item missing house interact_data — consume/Metadata checks will fail";
export const UNEXPECTED_FIELD_INTERACT_DATA_WARNING =
    "⚠ field item has unexpected house interact_data — consume/Metadata checks will fail";

export function itemFieldObservationMatches(
    observations: ItemFieldObservationRecorder | undefined,
    observed: Action | Condition,
    property: string,
    entry: ProjectItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string | undefined
): boolean {
    if (observations === undefined) return false;
    const observation = observations.get(observed, property);
    if (
        observation === undefined ||
        observation.canonicalKey !== canonicalItemShellTagKey(entry.nbt)
    ) {
        return false;
    }
    const item = entry.importable;
    const expectation =
        item === undefined
            ? { kind: "absent" as const }
            : expectedInteractData(item, dependencies, housingUuid);
    return interactDataPresenceMatches(observation.snbt, expectation);
}

export function itemFieldInteractDataWarning(
    observations: ItemFieldObservationRecorder | undefined,
    observed: Action | Condition,
    property: string,
    entry: ProjectItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string | undefined
): string | undefined {
    const observation = observations?.get(observed, property);
    if (observation === undefined) return undefined;
    const expectation =
        entry.importable === undefined
            ? { kind: "absent" as const }
            : expectedInteractData(entry.importable, dependencies, housingUuid);
    if (expectation.kind === "uncached") return undefined;
    const hasInteractData = itemHasInteractData(observation.snbt);
    if (expectation.kind === "cached" && !hasInteractData) {
        return MISSING_FIELD_INTERACT_DATA_WARNING;
    }
    if (expectation.kind === "absent" && hasInteractData) {
        return UNEXPECTED_FIELD_INTERACT_DATA_WARNING;
    }
    return undefined;
}

function interactDataPresenceMatches(
    itemSnbt: string,
    expectation: ReturnType<typeof expectedInteractData> | { kind: "absent" }
): boolean {
    if (expectation.kind === "uncached") return false;
    const hasInteractData = itemHasInteractData(itemSnbt);
    return expectation.kind === "cached" ? hasInteractData : !hasInteractData;
}

function itemHasInteractData(itemSnbt: string): boolean {
    try {
        const item = htsw.nbt.parseSnbtText(itemSnbt) as TagLike;
        return (
            tagChild(
                tagChild(tagChild(item, "tag"), "ExtraAttributes"),
                "interact_data"
            ) !== undefined
        );
    } catch (_error) {
        return false;
    }
}
